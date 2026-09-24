import { useStore } from "../store";
import { collab } from "../collab/manager";
import type { SceneMeta } from "../types";
import { serializeScene, type SceneDocument } from "../export/json";
import { parseSceneFile } from "../export/json";
import { history } from "../history";
import { clearShapeCache } from "../renderer/shapes";
import { api, ApiError, loadToken, setToken, type KeyState } from "./api";
import {
  decryptRecord,
  decryptRecordJSON,
  deriveKeys,
  encryptRecord,
  encryptRecordJSON,
  arkCheckContext,
  verifyCheck,
  type AccountKeys,
  type Keyring,
  type RecordContext,
  type RecordType,
} from "../crypto/e2ee";
import {
  AccountKeyError,
  buildRing,
  openAccount,
  provisionLegacyAccount,
  provisionNewAccount,
  rewrapForNewPassword,
  rewrapForNewRecoveryCode,
  rewrapFromRecovery,
  openWithPasskey,
  wrapArkForPasskey,
} from "../crypto/account";
import { assertPasskey, createPasskey, PasskeyError } from "../crypto/passkey";
import { generateRecoveryCode, recoveryKeysFromCode } from "../crypto/recovery";
import {
  type PendingFolderChange,
  clearAllLocalData,
  clearEncKey,
  loadKeyMaterial,
  loadLegacyEncKey,
  loadGuestDoc,
  loadRemoteCache,
  loadSceneDoc,
  saveGuestDoc,
  saveRemoteCache,
  saveRoomDoc,
  loadRoomDoc,
  loadRoomResume,
  deleteRoomDoc,
  saveSceneDoc,
  deleteSceneDoc,
  storeKeyMaterial,
} from "./local";
import { DEFAULT_CANVAS_BG } from "../constants";
import { zoomToFit } from "../interaction/view";

const AUTOSAVE_DEBOUNCE = 900;
const RETRY_INTERVAL = 15_000;

const newRecordId = () => crypto.randomUUID();

const isQuotaError = (err: unknown) =>
  err instanceof ApiError && err.status === 413 && err.code === "quota-exceeded";

const encodeFolderName = (name: string, color: string | null) =>
  color ? JSON.stringify({ n: name, c: color }) : name;

const decodeFolderName = (raw: string): { name: string; color: string | null } => {
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { n?: unknown; c?: unknown };
      if (parsed && typeof parsed.n === "string") {
        return {
          name: parsed.n,
          color: typeof parsed.c === "string" ? parsed.c : null,
        };
      }
    } catch {
      void 0;
    }
  }
  return { name: raw, color: null };
};

class SyncManager {
  private userId: string | null = null;
  private ark: CryptoKey | null = null;
  private ring: Keyring | null = null;
  private saveTimer: number | null = null;
  private retryTimer: number | null = null;
  private pushing = false;
  private quotaNotified = false;
  private pendingPush = new Set<string>();
  private pendingDeletes = new Set<string>();
  private pendingFolders = new Map<string, PendingFolderChange>();

  private hasPending() {
    return this.pendingPush.size > 0 || this.pendingDeletes.size > 0 || this.pendingFolders.size > 0;
  }
  private revisions = new Map<string, number>();
  private openRequest = 0;
  private lastOpenSceneId: string | null = null;
  private guestMode = true;
  private roomSceneId: string | null = null;
  private nextSceneAfterRoom: string | "new" | null = null;
  private newSceneFolderId: string | null = null;
  private beforeRoomSceneId: string | null = null;

  private ctx(type: RecordType, id: string): RecordContext {
    if (!this.userId) throw new Error("No account context");
    return { userId: this.userId, type, id };
  }

  async init() {
    const s = useStore.getState();
    const token = loadToken();
    if (!token) return this.startGuest();

    const material = await loadKeyMaterial();
    if (material) {
      this.userId = material.userId;
      this.ark = material.ark;
      this.ring = { writeEpoch: material.ring.writeEpoch, keys: new Map(material.ring.entries) };
      try {
        const me = await api.me();
        if (
          me.userId !== material.userId ||
          !(await verifyCheck(material.ark, me.arkCheck ?? "", arkCheckContext(me.userId)))
        ) {
          await clearEncKey();
          return this.enterLockedState(token, me.email);
        }
        s.setUser({ email: me.email, token });
        this.guestMode = false;
        await this.syncKeyring(me);
        s.setSyncStatus("syncing");
        await this.hydrateFromCache();
        await this.refreshRemote();
        await this.openLastScene();
        if (this.hasPending()) this.scheduleRetry();
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          await clearEncKey();
          return this.startGuest();
        }
        const cached = await this.hydrateFromCache();
        if (cached) {
          s.setUser({ email: this.parseTokenEmail(token) ?? "you", token });
          this.guestMode = false;
          s.setSyncStatus("offline");
          await this.openLastScene();
          this.scheduleRetry();
          return;
        }
        return this.startGuest();
      }
    }

    const email = this.parseTokenEmail(token);
    if (email) return this.enterLockedState(token, email);
    setToken(null);
    await this.startGuest();
  }

  private async enterLockedState(token: string, email: string) {
    const s = useStore.getState();
    this.userId = null;
    this.ark = null;
    this.ring = null;
    this.guestMode = true;
    s.setSyncStatus("locked");
    s.setLockedAccount({ email, hadLegacyKey: !!(await loadLegacyEncKey()) });
    s.setDialog("unlock");
    void token;
    await this.loadGuestScene();
  }

  private async startGuest() {
    const s = useStore.getState();
    this.guestMode = true;
    this.userId = null;
    this.ark = null;
    this.ring = null;
    s.setSyncStatus("offline-guest");
    await this.loadGuestScene();
  }

  private async syncKeyring(state: KeyState) {
    if (!this.ark || !this.userId) return;
    this.ring = await buildRing(
      this.ark,
      state.dataKeys,
      state.writeEpoch,
      this.userId,
    );
    await this.persistKeys();
  }

  private async persistKeys() {
    if (!this.userId || !this.ark || !this.ring) return;
    await storeKeyMaterial(this.userId, this.ark, {
      writeEpoch: this.ring.writeEpoch,
      entries: [...this.ring.keys.entries()],
    });
  }

  private parseTokenEmail(token: string): string | null {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return typeof payload.email === "string" ? payload.email : null;
    } catch {
      return null;
    }
  }

  private async loadGuestScene() {
    const s = useStore.getState();
    const doc = await loadGuestDoc();
    if (doc) {
      this.applyDocument(doc);
    } else {
      s.replaceElements([]);
      s.setCanvasBg(DEFAULT_CANVAS_BG);
    }
    s.setScene(null, "Scratchpad");
    history.reset();
  }

  private applyDocument(doc: SceneDocument, keepDeleted = false) {
    const s = useStore.getState();
    clearShapeCache();
    try {
      const parsed = parseSceneFile(JSON.stringify(doc), keepDeleted);
      s.replaceElements(parsed.elements);
      s.setCanvasBg(parsed.canvasBg);
    } catch {
      s.replaceElements([]);
      s.setCanvasBg(DEFAULT_CANVAS_BG);
    }
    s.clearSelection();
  }

  private async hydrateFromCache(): Promise<boolean> {
    const s = useStore.getState();
    const cache = await loadRemoteCache();
    if (!cache) return false;
    if (cache.userId && cache.userId !== this.userId) return false;
    this.pendingDeletes = new Set(cache.pendingDeletes ?? []);
    this.pendingFolders = new Map((cache.pendingFolders ?? []).map((change) => [change.id, change]));
    s.setScenes(
      cache.scenes.map(
        (sc): SceneMeta => ({
          id: sc.id,
          title: sc.title,
          folderId: sc.folderId,
          remoteVersion: sc.version,
          createdAt: sc.createdAt,
          updatedAt: sc.updatedAt,
          dirty: sc.dirty,
        }),
      ),
    );
    s.setFolders(
      cache.folders.map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color ?? null,
        createdAt: f.createdAt,
      })),
    );
    this.lastOpenSceneId = cache.lastOpenSceneId;
    for (const sc of cache.scenes) {
      if (sc.dirty) this.pendingPush.add(sc.id);
    }
    return true;
  }

  private async persistCache() {
    const s = useStore.getState();
    await saveRemoteCache({
      userId: this.userId ?? undefined,
      pendingDeletes: [...this.pendingDeletes],
      pendingFolders: [...this.pendingFolders.values()],
      scenes: s.scenes.map((sc) => ({
        id: sc.id,
        title: sc.title,
        folderId: sc.folderId,
        version: sc.remoteVersion,
        createdAt: sc.createdAt,
        updatedAt: sc.updatedAt,
        dirty: sc.dirty,
      })),
      folders: s.folders.map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        createdAt: f.createdAt,
      })),
      lastOpenSceneId: s.sceneId ?? this.lastOpenSceneId,
    });
  }

  private async refreshRemote() {
    const s = useStore.getState();
    if (!this.ring) return;
    const deletedAtStart = new Set(this.pendingDeletes);
    const deletedFoldersAtStart = new Set([...this.pendingFolders.values()].filter((f) => f.kind === "delete").map((f) => f.id));
    const { scenes, folders, sceneBytes, quotaBytes } = await api.listScenes();
    s.setStorage({ sceneBytes, quotaBytes });
    const existing = new Map(s.scenes.map((sc) => [sc.id, sc]));
    const metas: SceneMeta[] = [];
    for (const remote of scenes) {
      if (this.pendingDeletes.has(remote.id)) continue;
      const prev = existing.get(remote.id);
      if (prev?.dirty) {
        metas.push(prev);
        continue;
      }
      let title = prev?.title ?? "Untitled";
      try {
        title = await decryptRecord(
          this.ring,
          this.ctx("sceneTitle", remote.id),
          remote.encTitle,
        );
      } catch {
        title = prev?.title ?? "(cannot decrypt)";
      }
      metas.push({
        id: remote.id,
        title,
        folderId: remote.folderId,
        remoteVersion: prev?.remoteVersion ?? remote.version,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        dirty: prev?.dirty ?? false,
      });
    }
    for (const [id, prev] of existing) {
      if (prev.dirty && !metas.some((m) => m.id === id)) metas.push(prev);
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    const folderMetas = [];
    for (const f of folders) {
      let name = "(cannot decrypt)";
      let color: string | null = null;
      try {
        const raw = await decryptRecord(this.ring, this.ctx("folderName", f.id), f.encName);
        ({ name, color } = decodeFolderName(raw));
      } catch {
        void 0;
      }
      folderMetas.push({ id: f.id, name, color, createdAt: f.createdAt });
    }
    folderMetas.sort((a, b) => a.name.localeCompare(b.name));
    // Preserve changes made while the listing and title decryptions were pending.
    const current = useStore.getState().scenes;
    const merged = metas.map((meta) => {
      const latest = current.find((sc) => sc.id === meta.id);
      return latest && latest !== existing.get(meta.id) ? latest : meta;
    });
    for (const meta of current) {
      if (!existing.has(meta.id) && !merged.some((sc) => sc.id === meta.id)) merged.push(meta);
    }
    s.setScenes(merged.filter((meta) =>
      !this.pendingDeletes.has(meta.id) && !deletedAtStart.has(meta.id) &&
      (!existing.has(meta.id) || current.some((sc) => sc.id === meta.id)),
    ));
    const currentFolders = useStore.getState().folders;
    const folderById = new Map(s.folders.map((f) => [f.id, f]));
    const mergedFolders = folderMetas.filter((f) =>
      !deletedFoldersAtStart.has(f.id) && this.pendingFolders.get(f.id)?.kind !== "delete" &&
      (!folderById.has(f.id) || currentFolders.some((current) => current.id === f.id)),
    ).map((f) => {
      const pending = this.pendingFolders.get(f.id);
      const current = currentFolders.find((current) => current.id === f.id);
      if (pending?.kind === "rename") return { ...f, name: pending.name, color: pending.color };
      return current && current !== folderById.get(f.id) ? current : f;
    });
    for (const f of currentFolders) {
      if (!folderById.has(f.id) && !mergedFolders.some((current) => current.id === f.id)) mergedFolders.push(f);
    }
    s.setFolders(mergedFolders);
    s.setSyncStatus(this.hasPending() ? "syncing" : "synced");
    await this.persistCache();
  }

  private async openLastScene() {
    const s = useStore.getState();
    const target =
      s.scenes.find((sc) => sc.id === this.lastOpenSceneId) ?? s.scenes[0];
    if (!target) {
      await this.createScene("First canvas", null, true);
      return;
    }
    await this.openScene(target.id);
  }

  async openScene(id: string) {
    const s = useStore.getState();
    if (s.sceneId === id) return;
    const request = ++this.openRequest;
    if (!(await this.releaseRoomScene())) await this.flushNow();
    if (request !== this.openRequest) return;
    const meta = useStore.getState().scenes.find((sc) => sc.id === id);
    if (!meta) return;
    const cached = await loadSceneDoc(id);
    if (request !== this.openRequest || this.pendingDeletes.has(id)) return;
    if (cached) {
      this.applyDocument(cached);
      s.setScene(id, meta.title);
      history.reset();
    }
    this.lastOpenSceneId = id;
    const baseline = useStore.getState();
    const unchanged = () => {
      const current = useStore.getState();
      return request === this.openRequest && !this.pendingDeletes.has(id) &&
        current.sceneId === baseline.sceneId &&
        current.sceneNonce === baseline.sceneNonce && current.canvasBg === baseline.canvasBg &&
        !current.scenes.find((sc) => sc.id === id)?.dirty;
    };
    if (!cached || !meta.dirty) {
      try {
        if (this.ring) {
          const remote = await api.getScene(id);
          const doc = await decryptRecordJSON<SceneDocument>(
            this.ring,
            this.ctx("scene", id),
            remote.encData,
          );
          if (!unchanged()) {
            if (request === this.openRequest && !this.pendingDeletes.has(id) && !useStore.getState().sceneId) {
              s.setScene(id, meta.title);
              await this.flushNow();
            }
            return;
          }
          if (!cached || remote.version >= meta.remoteVersion) {
            this.applyDocument(doc);
            s.setScene(id, meta.title);
            history.reset();
            this.updateMeta(id, { remoteVersion: remote.version });
            await saveSceneDoc(id, doc);
          }
        }
      } catch {
        if (!cached) {
          s.toast("Could not load scene — you appear to be offline", "error");
          return;
        }
      }
    }
    if (request !== this.openRequest) return;
    if (!useStore.getState().sceneId) {
      s.setScene(id, meta.title);
      history.reset();
    }
    zoomToFit();
    await this.persistCache();
  }

  private updateMeta(id: string, patch: Partial<SceneMeta>) {
    const s = useStore.getState();
    s.setScenes(
      s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)),
    );
  }

  private markDirty(id: string) {
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    this.updateMeta(id, { dirty: true, updatedAt: Date.now() });
    this.pendingPush.add(id);
  }

  private acknowledgePush(id: string, revision: number, version: number, updatedAt?: number) {
    if (this.pendingDeletes.has(id)) return;
    const dirty = (this.revisions.get(id) ?? 0) !== revision;
    if (!dirty) this.pendingPush.delete(id);
    this.updateMeta(id, { dirty, remoteVersion: version, ...(updatedAt === undefined ? {} : { updatedAt }) });
  }

  private localSaveRevision = 0;

  onSceneMutated() {
    this.localSaveRevision++;
    useStore.getState().setLocalSaveStatus("saving");
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushNow().catch(() => undefined);
    }, AUTOSAVE_DEBOUNCE);
  }

  async flushNow() {
    const revision = this.localSaveRevision;
    const sceneId = useStore.getState().sceneId;
    useStore.getState().setLocalSaveStatus("saving");
    try {
      await this.persistCurrentScene();
      if (revision === this.localSaveRevision && sceneId === useStore.getState().sceneId) {
        useStore.getState().setLocalSaveStatus("saved");
      }
    } catch (error) {
      if (revision === this.localSaveRevision && sceneId === useStore.getState().sceneId) {
        useStore.getState().setLocalSaveStatus("error");
      }
      throw error;
    }
  }

  private async persistCurrentScene() {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const s = useStore.getState();
    if (this.roomSceneId) {
      await saveRoomDoc(
        this.roomSceneId,
        serializeScene(s.elements, s.canvasBg, s.sceneTitle, true),
      );
      return;
    }
    const doc = serializeScene(s.elements, s.canvasBg);
    if (this.guestMode) {
      await saveGuestDoc(doc);
      return;
    }
    const id = s.sceneId;
    if (!id || this.pendingDeletes.has(id)) return;
    const prev = await loadSceneDoc(id);
    if (prev && JSON.stringify(prev) === JSON.stringify(doc)) return;
    if (this.pendingDeletes.has(id)) return;
    this.markDirty(id);
    await saveSceneDoc(id, doc);
    await this.persistCache();
    void this.pushPending();
  }

  private async pushPending() {
    if (this.pushing || !this.ring) return;
    const s = useStore.getState();
    if (!s.user) return;
    this.pushing = true;
    s.setSyncStatus("syncing");
    let quotaHit = false;
    try {
      while (this.hasPending()) {
        if (this.pendingFolders.size) {
          const change = this.pendingFolders.values().next().value!;
          if (change.kind === "delete") await api.deleteFolder(change.id);
          else {
            const encName = await encryptRecord(this.ring, this.ctx("folderName", change.id), encodeFolderName(change.name, change.color));
            try { await api.renameFolder(change.id, encName); }
            catch (err) {
              if (!(err instanceof ApiError && err.status === 404)) throw err;
              useStore.getState().setFolders(useStore.getState().folders.filter((f) => f.id !== change.id));
            }
          }
          if (this.pendingFolders.get(change.id) === change) this.pendingFolders.delete(change.id);
          await this.persistCache();
          continue;
        }
        if (this.pendingDeletes.size) {
          const id = [...this.pendingDeletes][0];
          try {
            await api.deleteScene(id);
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) throw err;
          }
          await deleteSceneDoc(id);
          this.pendingDeletes.delete(id);
          await this.persistCache();
          continue;
        }
        const id = [...this.pendingPush][0];
        const revision = this.revisions.get(id) ?? 0;
        let meta = useStore.getState().scenes.find((sc) => sc.id === id);
        let doc = await loadSceneDoc(id);
        if (!meta) {
          this.pendingPush.delete(id);
          continue;
        }
        if (!doc) {
          const remote = await api.getScene(id);
          doc = await decryptRecordJSON<SceneDocument>(this.ring, this.ctx("scene", id), remote.encData);
          await saveSceneDoc(id, doc);
          this.updateMeta(id, { remoteVersion: remote.version });
          meta = { ...meta, remoteVersion: remote.version };
        }
        const encData = await encryptRecordJSON(this.ring, this.ctx("scene", id), doc);
        const encTitle = await encryptRecord(
          this.ring,
          this.ctx("sceneTitle", id),
          meta.title,
        );
        try {
          const res = await api.updateScene(id, {
            encData,
            encTitle,
            folderId: meta.folderId,
            version: meta.remoteVersion,
          });
          this.acknowledgePush(id, revision, res.version, res.updatedAt);
        } catch (err) {
          if (this.pendingDeletes.has(id)) continue;
          if (err instanceof ApiError && err.status === 409) {
            await this.resolveConflict(id, doc, revision);
            continue;
          }
          if (err instanceof ApiError && err.status === 404) {
            const created = await api.createScene({
              id,
              encData,
              encTitle,
              folderId: meta.folderId,
            });
            if (created.id !== id) {
              await this.adoptNewId(id, created.id, created.version, doc);
            } else {
              this.acknowledgePush(id, revision, created.version);
            }
            continue;
          }
          if (isQuotaError(err)) {
            quotaHit = true;
            break;
          }
          throw err;
        }
      }
      if (quotaHit) {
        this.reportQuotaReached();
      } else {
        this.quotaNotified = false;
        useStore.getState().setSyncStatus("synced");
      }
      await this.persistCache();
    } catch (err) {
      if (isQuotaError(err)) {
        this.reportQuotaReached();
        await this.persistCache();
        return;
      }
      const status =
        err instanceof ApiError && err.status === 401 ? "error" : "offline";
      useStore.getState().setSyncStatus(status);
      if (status === "error") {
        useStore.getState().toast("Session expired — please sign in again", "error");
        await this.signOut(false);
      } else {
        this.scheduleRetry();
      }
    } finally {
      this.pushing = false;
    }
  }

  private reportQuotaReached() {
    const s = useStore.getState();
    s.setSyncStatus("error");
    if (this.quotaNotified) return;
    this.quotaNotified = true;
    s.toast(
      "Storage quota reached — your changes stay on this device until you delete some scenes",
      "error",
    );
  }

  private async adoptNewId(
    oldId: string,
    newId: string,
    version: number,
    doc: SceneDocument,
  ) {
    const s = useStore.getState();
    await saveSceneDoc(newId, doc);
    await deleteSceneDoc(oldId);
    s.setScenes(
      s.scenes.map((sc) =>
        sc.id === oldId
          ? { ...sc, id: newId, remoteVersion: version, dirty: false }
          : sc,
      ),
    );
    if (s.sceneId === oldId) s.setScene(newId, s.sceneTitle);
    if (this.lastOpenSceneId === oldId) this.lastOpenSceneId = newId;
  }

  private async resolveConflict(id: string, localDoc: SceneDocument, revision: number) {
    const s = useStore.getState();
    if (!this.ring) return;
    try {
      const remote = await api.getScene(id);
      const remoteDoc = await decryptRecordJSON<SceneDocument>(
        this.ring,
        this.ctx("scene", id),
        remote.encData,
      );
      if (JSON.stringify(remoteDoc) === JSON.stringify(localDoc)) {
        this.updateMeta(id, { remoteVersion: remote.version });
        return;
      }
      const meta = s.scenes.find((sc) => sc.id === id);
      const conflictTitle = `${meta?.title ?? "Scene"} (conflict copy)`;
      const copyId = newRecordId();
      const encData = await encryptRecordJSON(
        this.ring,
        this.ctx("scene", copyId),
        localDoc,
      );
      const encTitle = await encryptRecord(
        this.ring,
        this.ctx("sceneTitle", copyId),
        conflictTitle,
      );
      const created = await api.createScene({
        id: copyId,
        encData,
        encTitle,
        folderId: meta?.folderId ?? null,
      });
      await saveSceneDoc(created.id, localDoc);
      const unchanged = !this.pendingDeletes.has(id) && (this.revisions.get(id) ?? 0) === revision;
      if (unchanged) {
        await saveSceneDoc(id, remoteDoc);
        this.acknowledgePush(id, revision, remote.version);
      }
      const now = Date.now();
      s.setScenes([
        {
          id: created.id,
          title: conflictTitle,
          folderId: meta?.folderId ?? null,
          remoteVersion: created.version,
          createdAt: now,
          updatedAt: now,
          dirty: false,
        },
        ...useStore.getState().scenes,
      ]);
      if (unchanged && useStore.getState().sceneId === id) {
        s.setScene(created.id, conflictTitle);
        this.lastOpenSceneId = created.id;
      }
      s.toast(
        "This scene changed on another device — your edits were kept as a conflict copy",
        "info",
      );
      s.setSyncStatus("synced");
    } catch (err) {
      s.setSyncStatus("conflict");
      s.toast("Sync conflict — could not reconcile with the server", "error");
      throw err;
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.hasPending()) void this.pushPending();
      else void this.refreshRemote().catch(() => this.scheduleRetry());
    }, RETRY_INTERVAL);
  }

  onOnline() {
    if (this.guestMode) return;
    if (this.hasPending()) void this.pushPending();
    else void this.refreshRemote().catch(() => void 0);
  }

  async signUp(
    email: string,
    password: string,
    inviteCode?: string,
  ): Promise<string> {
    const { authKey, kek } = await deriveKeys(email, password);
    const userId = newRecordId();
    const recoveryCode = generateRecoveryCode();
    const { change, account } = await provisionNewAccount(userId, kek, recoveryCode);
    const res = await api.register(email, authKey, userId, change, inviteCode);
    await this.adoptAccount(account);
    await this.completeAuth(res.token, res.email);
    return recoveryCode;
  }

  async signIn(email: string, password: string): Promise<string | null> {
    const keys = await deriveKeys(email, password);
    const res = await api.login(email, keys.authKey);
    const opened = await this.establishAccount(res, keys);
    await this.completeAuth(opened.token, res.email);
    return opened.recoveryCode;
  }

  async unlock(email: string, password: string): Promise<string | null> {
    const keys = await deriveKeys(email, password);
    const res = await api.login(email, keys.authKey);
    const opened = await this.establishAccount(res, keys);
    useStore.getState().setLockedAccount(null);
    await this.completeAuth(opened.token, res.email);
    return opened.recoveryCode;
  }

  private async establishAccount(
    state: KeyState & { token: string },
    keys: AccountKeys,
  ): Promise<{ token: string; recoveryCode: string | null }> {
    if (state.wraps.some((w) => w.kind === "password")) {
      await this.adoptAccount(await openAccount(keys.kek, state));
      return { token: state.token, recoveryCode: null };
    }
    const recoveryCode = generateRecoveryCode();
    const { change, account } = await provisionLegacyAccount(
      state.userId,
      keys.kek,
      await keys.deriveLegacyDataKey(),
      recoveryCode,
    );
    setToken(state.token);
    const keysToken = (await api.reauth(keys.authKey)).token;
    try {
      const res = await api.rewrap(keysToken, { ...change, expectNoHierarchy: true });
      await this.adoptAccount(account);
      setToken(res.token);
      return { token: res.token, recoveryCode };
    } catch (err) {
      if (err instanceof ApiError && err.code === "hierarchy-exists") {
        await this.adoptAccount(await openAccount(keys.kek, await api.getKeys()));
        return { token: state.token, recoveryCode: null };
      }
      throw err;
    }
  }

  private async adoptAccount(account: {
    userId: string;
    ark: CryptoKey;
    ring: Keyring;
  }) {
    this.userId = account.userId;
    this.ark = account.ark;
    this.ring = account.ring;
    await this.persistKeys();
  }

  private async currentKeyState(): Promise<KeyState> {
    return api.getKeys();
  }

  async changePassword(current: string, next: string): Promise<void> {
    const s = useStore.getState();
    const email = s.user?.email;
    if (!email || !this.userId) throw new AccountKeyError("no-session", "Not signed in");
    const currentKeys = await deriveKeys(email, current);
    const keysToken = (await api.reauth(currentKeys.authKey)).token;
    const state = await this.currentKeyState();
    const nextKeys = await deriveKeys(email, next);
    const change = await rewrapForNewPassword(
      this.userId,
      currentKeys.kek,
      nextKeys.kek,
      nextKeys.authKey,
      state,
    );
    const res = await api.rewrap(keysToken, change);
    setToken(res.token);
    s.setUser({ email, token: res.token });
  }

  async regenerateRecoveryCode(password: string): Promise<string> {
    const s = useStore.getState();
    const email = s.user?.email;
    if (!email || !this.userId) throw new AccountKeyError("no-session", "Not signed in");
    const keys = await deriveKeys(email, password);
    const keysToken = (await api.reauth(keys.authKey)).token;
    const state = await this.currentKeyState();
    const code = generateRecoveryCode();
    const change = await rewrapForNewRecoveryCode(this.userId, keys.kek, state, code);
    const res = await api.rewrap(keysToken, change);
    setToken(res.token);
    return code;
  }

  async addPasskey(password: string, label: string): Promise<void> {
    const s = useStore.getState();
    const email = s.user?.email;
    if (!email || !this.userId) throw new AccountKeyError("no-session", "Not signed in");
    const keys = await deriveKeys(email, password);
    const keysToken = (await api.reauth(keys.authKey)).token;
    const state = await api.getKeys();

    const registerChallenge = (await api.passkeyChallenge("register")).challenge;
    const created = await createPasskey(registerChallenge, this.userId, email, label);

    const proofChallenge = (await api.passkeyChallenge("auth")).challenge;
    const assertion = await assertPasskey(proofChallenge, created.credentialId);
    if (assertion.credentialId !== created.credentialId) {
      throw new PasskeyError("wrong-credential", "A different passkey answered");
    }

    const wrapped = await wrapArkForPasskey(
      this.userId,
      keys.kek,
      state,
      assertion.kek,
    );
    await api.registerPasskey(keysToken, {
      credentialId: created.credentialId,
      publicKey: created.publicKey,
      alg: created.alg,
      transports: created.transports,
      clientDataJSON: created.clientDataJSON,
      authenticatorData: created.authenticatorData,
      challenge: registerChallenge,
      wrapped,
      label,
      assertion: {
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
        challenge: proofChallenge,
      },
    });
  }

  async removePasskey(password: string, credentialId: string): Promise<void> {
    const s = useStore.getState();
    const email = s.user?.email;
    if (!email) throw new AccountKeyError("no-session", "Not signed in");
    const keys = await deriveKeys(email, password);
    const keysToken = (await api.reauth(keys.authKey)).token;
    const res = await api.removePasskey(keysToken, credentialId);
    setToken(res.token);
    useStore.getState().setUser({ email, token: res.token });
  }

  async signInWithPasskey(): Promise<void> {
    const { challenge } = await api.passkeyChallenge("auth");
    const assertion = await assertPasskey(challenge);
    const res = await api.passkeyLogin({
      credentialId: assertion.credentialId,
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
      challenge,
    });
    setToken(res.token);
    await this.adoptAccount(
      await openWithPasskey(assertion.kek, assertion.credentialId, res),
    );
    useStore.getState().setLockedAccount(null);
    await this.completeAuth(res.token, res.email);
  }

  async recoverAccount(email: string, code: string, newPassword: string) {
    const recovery = await recoveryKeysFromCode(code);
    const res = await api.recover(email, recovery.authKey);
    const next = await deriveKeys(res.email, newPassword);
    const change = await rewrapFromRecovery(
      res.userId,
      recovery.kek,
      res.wrapped,
      next.kek,
      next.authKey,
      res.arkCheck,
    );
    const done = await api.recoverComplete(res.token, change);
    setToken(done.token);
    await this.adoptAccount(await openAccount(next.kek, done));
    useStore.getState().setLockedAccount(null);
    await this.completeAuth(done.token, done.email);
  }

  private async completeAuth(token: string, email: string) {
    const s = useStore.getState();
    setToken(token);
    this.guestMode = false;
    s.setUser({ email, token });
    s.setSyncStatus("syncing");
    await this.releaseRoomScene();
    const guestDoc = await loadGuestDoc();
    this.pendingPush.clear();
    this.pendingDeletes.clear();
    this.pendingFolders.clear();
    s.setScenes([]);
    s.setFolders([]);
    await this.hydrateFromCache();
    await this.refreshRemote();
    const state = useStore.getState();
    if (!state.scenes.length) {
      const hasGuestContent = !!guestDoc?.elements?.length;
      const title = hasGuestContent ? "Scratchpad" : "First canvas";
      const id = await this.createScene(title, null, !hasGuestContent);
      if (hasGuestContent && id && guestDoc) {
        await saveSceneDoc(id, guestDoc);
        this.applyDocument(guestDoc);
        useStore.getState().setScene(id, title);
        history.reset();
        this.pendingPush.add(id);
        this.updateMeta(id, { dirty: true });
        void this.pushPending();
      }
    } else {
      await this.openLastScene();
    }
    if (this.hasPending()) this.scheduleRetry();
    void import("../publish")
      .then((m) => m.syncPublishRecords())
      .catch(() => void 0);
  }

  async signOut(clearData = true) {
    ++this.openRequest;
    const s = useStore.getState();
    await this.releaseRoomScene();
    await this.flushNow().catch(() => void 0);
    setToken(null);
    this.userId = null;
    this.ark = null;
    this.ring = null;
    this.pendingPush.clear();
    this.pendingDeletes.clear();
    this.pendingFolders.clear();
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.revisions.clear();
    this.quotaNotified = false;
    this.lastOpenSceneId = null;
    if (clearData) await clearAllLocalData();
    else await clearEncKey();
    s.setUser(null);
    s.setScenes([]);
    s.setFolders([]);
    s.setStorage(null);
    s.setLockedAccount(null);
    this.guestMode = true;
    s.setSyncStatus("offline-guest");
    await this.loadGuestScene();
  }

  async createScene(
    title: string,
    folderId: string | null,
    open = true,
  ): Promise<string | null> {
    const s = useStore.getState();
    if (!this.ring || !s.user) return null;
    if (open) ++this.openRequest;
    const emptyDoc: SceneDocument = {
      type: "lakar",
      version: 1,
      appState: { canvasBg: DEFAULT_CANVAS_BG },
      elements: [],
    };
    try {
      const id = newRecordId();
      const encData = await encryptRecordJSON(
        this.ring,
        this.ctx("scene", id),
        emptyDoc,
      );
      const encTitle = await encryptRecord(
        this.ring,
        this.ctx("sceneTitle", id),
        title,
      );
      const res = await api.createScene({ id, encData, encTitle, folderId });
      await saveSceneDoc(res.id, emptyDoc);
      const meta: SceneMeta = {
        id: res.id,
        title,
        folderId,
        remoteVersion: res.version,
        createdAt: res.createdAt,
        updatedAt: res.updatedAt,
        dirty: false,
      };
      s.setScenes([meta, ...s.scenes]);
      if (open) {
        if (!(await this.releaseRoomScene())) await this.flushNow();
        this.applyDocument(emptyDoc);
        s.setScene(res.id, title);
        history.reset();
        this.lastOpenSceneId = res.id;
      }
      await this.persistCache();
      return res.id;
    } catch (err) {
      s.toast(
        err instanceof ApiError && err.status === 0
          ? "You're offline — new scenes need a connection"
          : isQuotaError(err)
            ? "Storage quota reached — delete a scene to make room"
            : "Could not create scene",
        "error",
      );
      return null;
    }
  }

  async renameScene(id: string, title: string) {
    const s = useStore.getState();
    if (!this.ring) return;
    this.updateMeta(id, { title });
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    if (s.sceneId === id) s.setSceneTitle(title);
    try {
      const meta = useStore.getState().scenes.find((sc) => sc.id === id);
      if (!meta) return;
      const encTitle = await encryptRecord(
        this.ring,
        this.ctx("sceneTitle", id),
        title,
      );
      const res = await api.updateScene(id, {
        encTitle,
        version: meta.remoteVersion,
      });
      this.updateMeta(id, { remoteVersion: res.version, updatedAt: res.updatedAt });
      await this.persistCache();
    } catch {
      s.toast("Rename will sync when you're back online", "info");
      this.updateMeta(id, { dirty: true });
      this.pendingPush.add(id);
      await this.persistCache();
      this.scheduleRetry();
    }
  }

  async deleteScene(id: string) {
    const s = useStore.getState();
    ++this.openRequest;
    this.pendingDeletes.add(id);
    const remaining = s.scenes.filter((sc) => sc.id !== id);
    s.setScenes(remaining);
    this.pendingPush.delete(id);
    if (s.sceneId === id) {
      s.setScene(null, "Untitled scene");
      s.replaceElements([]);
      history.reset();
      this.lastOpenSceneId = null;
    }
    // Persist the tombstone before removing the document or contacting the server.
    await this.persistCache();
    await deleteSceneDoc(id);
    await this.pushPending();
    if (!this.pushing && this.pendingDeletes.has(id)) s.toast("Delete will finish when you're back online", "info");
    if (s.sceneId === id) {
      if (remaining.length) await this.openScene(remaining[0].id);
      else await this.createScene("First canvas", null, true);
    }
    await this.persistCache();
  }

  async duplicateScene(id: string) {
    const s = useStore.getState();
    if (!this.ring) return;
    const meta = s.scenes.find((sc) => sc.id === id);
    const doc =
      s.sceneId === id
        ? serializeScene(s.elements, s.canvasBg)
        : await loadSceneDoc(id);
    if (!meta || !doc) return;
    const title = `${meta.title} copy`;
    try {
      const copyId = newRecordId();
      const encData = await encryptRecordJSON(
        this.ring,
        this.ctx("scene", copyId),
        doc,
      );
      const encTitle = await encryptRecord(
        this.ring,
        this.ctx("sceneTitle", copyId),
        title,
      );
      const res = await api.createScene({
        id: copyId,
        encData,
        encTitle,
        folderId: meta.folderId,
      });
      await saveSceneDoc(res.id, doc);
      s.setScenes([
        {
          id: res.id,
          title,
          folderId: meta.folderId,
          remoteVersion: res.version,
          createdAt: res.createdAt,
          updatedAt: res.updatedAt,
          dirty: false,
        },
        ...useStore.getState().scenes,
      ]);
      await this.persistCache();
    } catch {
      s.toast("Could not duplicate scene", "error");
    }
  }

  async moveSceneToFolder(id: string, folderId: string | null) {
    const s = useStore.getState();
    this.updateMeta(id, { folderId });
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    try {
      const meta = useStore.getState().scenes.find((sc) => sc.id === id);
      if (!meta) return;
      const res = await api.updateScene(id, {
        folderId,
        version: meta.remoteVersion,
      });
      this.updateMeta(id, { remoteVersion: res.version });
      await this.persistCache();
    } catch {
      this.updateMeta(id, { dirty: true });
      this.pendingPush.add(id);
      await this.persistCache();
      this.scheduleRetry();
    }
  }

  async createFolder(name: string): Promise<string | null> {
    const s = useStore.getState();
    if (!this.ring) return null;
    try {
      const id = newRecordId();
      const encName = await encryptRecord(this.ring, this.ctx("folderName", id), name);
      const res = await api.createFolder(encName, id);
      s.setFolders(
        [...s.folders, { id: res.id, name, color: null, createdAt: res.createdAt }].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      await this.persistCache();
      return res.id;
    } catch {
      s.toast("Could not create folder", "error");
      return null;
    }
  }

  private async queueFolder(change: PendingFolderChange) {
    this.pendingFolders.set(change.id, change);
    await this.persistCache();
    await this.pushPending();
  }

  async renameFolder(id: string, name: string) {
    const s = useStore.getState();
    if (!this.ring) return;
    const folder = s.folders.find((f) => f.id === id);
    if (!folder) return;
    s.setFolders(s.folders.map((f) => f.id === id ? { ...f, name } : f).sort((a, b) => a.name.localeCompare(b.name)));
    await this.queueFolder({ kind: "rename", id, name, color: folder.color ?? null });
  }

  async setFolderColor(id: string, color: string | null) {
    const s = useStore.getState();
    if (!this.ring) return;
    const folder = s.folders.find((f) => f.id === id);
    if (!folder || folder.color === color) return;
    s.setFolders(s.folders.map((f) => f.id === id ? { ...f, color } : f));
    await this.queueFolder({ kind: "rename", id, name: folder.name, color });
  }

  async deleteFolder(id: string) {
    const s = useStore.getState();
    s.setFolders(s.folders.filter((f) => f.id !== id));
    s.setScenes(s.scenes.map((sc) => sc.folderId === id ? { ...sc, folderId: null } : sc));
    await this.queueFolder({ kind: "delete", id });
  }

  async deleteAccount() {
    await api.deleteAccount();
    await this.signOut(true);
  }

  isSignedIn() {
    return !this.guestMode && !!this.ring;
  }

  hasRecoveryCapableSession() {
    return !!this.ring && !!this.userId;
  }

  async encryptForUser(id: string, value: unknown): Promise<string | null> {
    if (!this.ring) return null;
    return encryptRecordJSON(this.ring, this.ctx("satchel", id), value);
  }

  async decryptForUser<T>(id: string, transport: string): Promise<T | null> {
    if (!this.ring) return null;
    try {
      return await decryptRecordJSON<T>(this.ring, this.ctx("satchel", id), transport);
    } catch {
      return null;
    }
  }

  async encryptPublishSecret(publishId: string, secret: string) {
    if (!this.ring) return null;
    return encryptRecord(this.ring, this.ctx("publishSecret", publishId), secret);
  }

  async decryptPublishSecret(publishId: string, transport: string) {
    if (!this.ring) return null;
    try {
      return await decryptRecord(
        this.ring,
        this.ctx("publishSecret", publishId),
        transport,
      );
    } catch {
      return null;
    }
  }

  newRecordId() {
    return newRecordId();
  }

  inRoomScene() {
    return !!this.roomSceneId;
  }

  currentRoomSceneId() {
    return this.roomSceneId;
  }

  queueSceneAfterRoom(id: string | "new" | null, folderId: string | null = null) {
    this.nextSceneAfterRoom = id;
    this.newSceneFolderId = folderId;
  }

  async enterRoomScene(roomId: string, title: string) {
    ++this.openRequest;
    const s = useStore.getState();
    if (this.roomSceneId === roomId) {
      s.setScene(null, title);
      return;
    }
    await this.flushNow();
    if (!this.roomSceneId) this.beforeRoomSceneId = s.sceneId;
    this.roomSceneId = roomId;
    s.setScene(null, title);
  }

  async loadRoomSceneDoc(roomId: string): Promise<boolean> {
    const doc = await loadRoomDoc(roomId);
    if (!doc) return false;
    this.applyDocument(doc, true);
    history.reset();
    return true;
  }

  async releaseRoomScene(): Promise<boolean> {
    if (!this.roomSceneId) return false;
    if (collab.currentRoomId()) await collab.leave({ silent: true, keepScene: true });
    await this.flushNow();
    if (!(await loadRoomResume(this.roomSceneId))) {
      await deleteRoomDoc(this.roomSceneId);
    }
    this.roomSceneId = null;
    this.beforeRoomSceneId = null;
    this.nextSceneAfterRoom = null;
    this.newSceneFolderId = null;
    return true;
  }

  async exitRoomScene() {
    const s = useStore.getState();
    if (this.roomSceneId && !(await loadRoomResume(this.roomSceneId))) {
      await deleteRoomDoc(this.roomSceneId);
    }
    const queued = this.nextSceneAfterRoom;
    const queuedFolder = this.newSceneFolderId;
    const previous =
      queued && queued !== "new" && s.scenes.some((sc) => sc.id === queued)
        ? queued
        : this.beforeRoomSceneId;
    this.roomSceneId = null;
    this.beforeRoomSceneId = null;
    this.nextSceneAfterRoom = null;
    this.newSceneFolderId = null;
    if (queued === "new" && (await this.createScene("Untitled scene", queuedFolder, true))) {
      return;
    }
    if (previous && s.scenes.some((sc) => sc.id === previous)) {
      s.setScene(null, s.sceneTitle);
      await this.openScene(previous);
      return;
    }
    if (this.guestMode) {
      await this.loadGuestScene();
      return;
    }
    await this.openLastScene();
  }

  async saveRoomSceneAsCopy(title: string): Promise<boolean> {
    const s = useStore.getState();
    const doc = serializeScene(s.elements, s.canvasBg);
    if (this.guestMode || !this.ring) {
      await saveGuestDoc(doc);
      this.beforeRoomSceneId = null;
      return true;
    }
    try {
      const id = newRecordId();
      const encData = await encryptRecordJSON(this.ring, this.ctx("scene", id), doc);
      const encTitle = await encryptRecord(
        this.ring,
        this.ctx("sceneTitle", id),
        title,
      );
      const res = await api.createScene({ id, encData, encTitle, folderId: null });
      await saveSceneDoc(res.id, doc);
      s.setScenes([
        {
          id: res.id,
          title,
          folderId: null,
          remoteVersion: res.version,
          createdAt: res.createdAt,
          updatedAt: res.updatedAt,
          dirty: false,
        },
        ...s.scenes,
      ]);
      this.beforeRoomSceneId = res.id;
      await this.persistCache();
      return true;
    } catch {
      return false;
    }
  }
}

export const syncManager = new SyncManager();
