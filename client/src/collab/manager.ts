import { useStore, IDLE_COLLAB } from "../store";
import type {
  CollabPeer,
  LakarElement,
  Point,
  RoomMode,
  ToolType,
} from "../types";
import { decryptString, encryptString } from "../crypto/e2ee";
import {
  buildRoomLink,
  clearRoomHash,
  keysFromPassword,
  keysFromSecret,
  newRoomId,
  newRoomSecret,
  writeRoomHash,
  type RoomKeys,
} from "../crypto/room";
import { api, ApiError } from "../sync/api";
import { syncManager } from "../sync/manager";
import { presence } from "./presence";
import { diffSince, mergeFullScene, mergeIncoming } from "./reconcile";
import { clearShapeCache, invalidateShape } from "../renderer/shapes";
import { parseSceneFile, serializeScene } from "../export/json";
import { history } from "../history";
import { zoomToFit } from "../interaction/view";
import { DEFAULT_CANVAS_BG } from "../constants";

const PEER_COLORS = [
  "#e0685f", "#e08a2e", "#caa62b", "#5aa053", "#2f9e8f",
  "#3a86c8", "#6366d8", "#9558c4", "#c9548f", "#7a8b5e",
];

const BROADCAST_INTERVAL = 90;
const POINTER_INTERVAL = 48;
const SNAPSHOT_DEBOUNCE = 5000;
const PRESENCE_SWEEP = 8000;
const RECONNECT_DELAYS = [800, 1600, 3200, 6000, 10_000];

type Wire =
  | { k: "hello"; name: string; color: string; joinedAt: number }
  | {
      k: "pointer";
      x: number;
      y: number;
      tool: ToolType;
      selectedIds: string[];
    }
  | { k: "update"; elements: LakarElement[]; canvasBg?: string }
  | { k: "ask-scene" }
  | { k: "scene"; elements: LakarElement[]; canvasBg: string }
  | { k: "bye" };

const colorFor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PEER_COLORS[hash % PEER_COLORS.length];
};

export class CollabError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class CollabManager {
  private socket: WebSocket | null = null;
  private keys: RoomKeys | null = null;
  private roomId: string | null = null;
  private secret: string | null = null;
  private mode: RoomMode = "link";
  private ownerToken: string | null = null;
  private selfId: string | null = null;
  private isHost = false;

  private sentVersions = new Map<string, number>();
  private lastSentBg: string | null = null;
  private broadcastTimer: number | null = null;
  private pointerTimer: number | null = null;
  private pointerPending: Wire | null = null;
  private lastPoint: Point | null = null;
  private snapshotTimer: number | null = null;
  private sweepTimer: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private intentionalClose = false;
  private leaving = false;
  private peerMeta = new Map<string, CollabPeer>();
  private askedPeers = new Set<string>();

  isLive() {
    return this.socket?.readyState === WebSocket.OPEN && !!this.roomId;
  }

  isHostSession() {
    return this.isHost;
  }

  currentRoomId() {
    return this.roomId;
  }

  async host(mode: RoomMode, password: string): Promise<void> {
    const roomId = newRoomId();
    let keys: RoomKeys;
    let secret: string | null = null;
    if (mode === "password") {
      keys = await keysFromPassword(roomId, password);
    } else {
      secret = newRoomSecret();
      keys = await keysFromSecret(secret);
    }
    const created = await api.createRoom(roomId, keys.verifier, mode);
    this.keys = keys;
    this.roomId = roomId;
    this.secret = secret;
    this.mode = mode;
    this.ownerToken = created.ownerToken;
    this.isHost = true;

    const s = useStore.getState();
    s.setCollab({
      status: "connecting",
      roomId,
      mode,
      isHost: true,
      peers: [],
      shareLink: buildRoomLink(roomId, secret),
    });
    this.resetOutbound();
    try {
      await this.connect();
    } catch (err) {
      await this.abortConnect(false);
      throw err;
    }
    writeRoomHash(roomId, secret);
    this.queueSnapshot(0);
  }

  private async abortConnect(restoreScene: boolean) {
    this.intentionalClose = true;
    this.socket?.close();
    this.socket = null;
    this.keys = null;
    this.roomId = null;
    this.secret = null;
    this.ownerToken = null;
    this.selfId = null;
    this.isHost = false;
    this.resetOutbound();
    useStore.getState().setCollab(IDLE_COLLAB);
    if (restoreScene) await syncManager.exitRoomScene();
  }

  async join(
    roomId: string,
    secret: string | null,
    password: string,
  ): Promise<void> {
    const info = await api.getRoom(roomId);
    const keys =
      info.mode === "password"
        ? await keysFromPassword(roomId, password)
        : await keysFromSecret(secret ?? "");
    this.keys = keys;
    this.roomId = roomId;
    this.secret = info.mode === "password" ? null : secret;
    this.mode = info.mode;
    this.ownerToken = null;
    this.isHost = false;

    const s = useStore.getState();
    s.setCollab({
      status: "connecting",
      roomId,
      mode: info.mode,
      isHost: false,
      peers: [],
      shareLink: buildRoomLink(roomId, this.secret),
    });

    await syncManager.enterRoomScene(roomId, "Shared canvas");
    s.replaceElements([]);
    s.setCanvasBg(DEFAULT_CANVAS_BG);
    s.clearSelection();
    clearShapeCache();
    history.reset();
    this.resetOutbound();

    try {
      await this.connect();
    } catch (err) {
      await this.abortConnect(true);
      throw err;
    }
    writeRoomHash(roomId, this.secret);

    if (info.peers === 0 && info.hasSnapshot) {
      await this.loadServerSnapshot();
    }
  }

  private resetOutbound() {
    this.sentVersions.clear();
    this.lastSentBg = null;
    this.askedPeers.clear();
    this.peerMeta.clear();
    presence.clear();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      this.socket = socket;
      this.intentionalClose = false;
      let settled = false;

      const fail = (code: string, message: string) => {
        if (settled) return;
        settled = true;
        this.intentionalClose = true;
        reject(new CollabError(code, message));
      };

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            t: "join",
            room: this.roomId,
            verifier: this.keys!.verifier,
          }),
        );
      };

      socket.onmessage = (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (message.t === "joined") {
          settled = true;
          this.reconnectAttempt = 0;
          this.onJoined(message as unknown as { id: string; peers: string[] });
          resolve();
          return;
        }
        if (message.t === "error") {
          const code = String(message.code ?? "error");
          fail(
            code,
            code === "denied"
              ? "That password or link is not valid for this session"
              : code === "no-room"
                ? "This session has ended"
                : code === "room-full"
                  ? "This session is full"
                  : "Could not join the session",
          );
          return;
        }
        if (message.t === "room-closed") {
          this.intentionalClose = true;
          void this.handleRoomClosed();
          return;
        }
        if (message.t === "peer-join" && typeof message.id === "string") {
          void this.sendWire(this.helloPayload(), message.id);
          return;
        }
        if (message.t === "peer-leave" && typeof message.id === "string") {
          this.dropPeer(message.id);
          return;
        }
        if (message.t === "msg" && typeof message.from === "string") {
          void this.onWire(message.from, String(message.d));
        }
      };

      socket.onerror = () => fail("network", "Could not reach the session server");

      socket.onclose = () => {
        if (!settled) {
          fail("network", "Could not reach the session server");
          return;
        }
        if (this.intentionalClose) return;
        this.scheduleReconnect();
      };
    });
  }

  private onJoined(message: { id: string; peers: string[] }) {
    this.selfId = message.id;
    const s = useStore.getState();
    const self: CollabPeer = {
      id: message.id,
      name: s.displayName,
      color: colorFor(message.id),
      isSelf: true,
      joinedAt: Date.now(),
    };
    this.peerMeta.set(message.id, self);
    s.setCollab({ status: "live", peers: this.peerList() });

    void this.sendWire(this.helloPayload());

    const [first] = message.peers;
    if (first && !this.askedPeers.has(first)) {
      this.askedPeers.add(first);
      void this.sendWire({ k: "ask-scene" }, first);
    }

    this.attachStoreWatcher();
    this.startSweep();
  }

  private helloPayload(): Wire {
    const s = useStore.getState();
    return {
      k: "hello",
      name: s.displayName.slice(0, 40),
      color: colorFor(this.selfId ?? "self"),
      joinedAt: Date.now(),
    };
  }

  private peerList(): CollabPeer[] {
    return [...this.peerMeta.values()].sort((a, b) =>
      a.isSelf === b.isSelf ? a.joinedAt - b.joinedAt : a.isSelf ? -1 : 1,
    );
  }

  private dropPeer(id: string) {
    this.peerMeta.delete(id);
    this.askedPeers.delete(id);
    presence.remove(id);
    useStore.getState().setCollab({ peers: this.peerList() });
  }

  private async sendWire(payload: Wire, to?: string) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.keys) return;
    try {
      const d = await encryptString(this.keys.key, JSON.stringify(payload));
      socket.send(JSON.stringify(to ? { t: "msg", to, d } : { t: "msg", d }));
    } catch {
      void 0;
    }
  }

  private async onWire(from: string, ciphertext: string) {
    if (!this.keys) return;
    let payload: Wire;
    try {
      payload = JSON.parse(
        await decryptString(this.keys.key, ciphertext),
      ) as Wire;
    } catch {
      return;
    }
    const s = useStore.getState();

    switch (payload.k) {
      case "hello": {
        const existing = this.peerMeta.get(from);
        this.peerMeta.set(from, {
          id: from,
          name: (payload.name || "Guest").slice(0, 40),
          color: payload.color || colorFor(from),
          isSelf: false,
          joinedAt: existing?.joinedAt ?? payload.joinedAt ?? Date.now(),
        });
        s.setCollab({ peers: this.peerList() });
        break;
      }
      case "pointer": {
        const meta = this.peerMeta.get(from);
        presence.set({
          id: from,
          x: payload.x,
          y: payload.y,
          color: meta?.color ?? colorFor(from),
          name: meta?.name ?? "Guest",
          tool: payload.tool,
          selectedIds: payload.selectedIds ?? [],
          updatedAt: Date.now(),
        });
        break;
      }
      case "update": {
        this.applyRemoteElements(payload.elements, payload.canvasBg);
        break;
      }
      case "ask-scene": {
        const current = useStore.getState();
        await this.sendWire(
          {
            k: "scene",
            elements: JSON.parse(
              JSON.stringify(current.elements),
            ) as LakarElement[],
            canvasBg: current.canvasBg,
          },
          from,
        );
        break;
      }
      case "scene": {
        this.applyRemoteScene(payload.elements, payload.canvasBg);
        break;
      }
      case "bye": {
        this.dropPeer(from);
        break;
      }
    }
  }

  private applyRemoteElements(incoming: LakarElement[], canvasBg?: string) {
    if (!Array.isArray(incoming) || !incoming.length) {
      if (canvasBg) this.applyRemoteBg(canvasBg);
      return;
    }
    const s = useStore.getState();
    const { elements, changed } = mergeIncoming(s.elements, incoming);
    if (canvasBg) this.applyRemoteBg(canvasBg);
    if (!changed.size) return;
    for (const el of elements) {
      if (changed.has(el.id)) {
        invalidateShape(el.id);
        this.sentVersions.set(el.id, el.version);
      }
    }
    const byId = new Map(elements.map((el) => [el.id, el]));
    const stillSelected = [...s.selectedIds].filter((id) => {
      const el = byId.get(id);
      return !!el && !el.isDeleted;
    });
    s.replaceElements(elements);
    if (stillSelected.length !== s.selectedIds.size) {
      s.setSelectedIds(stillSelected);
    }
  }

  private applyRemoteBg(canvasBg: string) {
    const s = useStore.getState();
    if (s.canvasBg === canvasBg) return;
    this.lastSentBg = canvasBg;
    s.setCanvasBg(canvasBg);
  }

  private applyRemoteScene(incoming: LakarElement[], canvasBg: string) {
    if (!Array.isArray(incoming)) return;
    const s = useStore.getState();
    const wasEmpty = !s.elements.some((el) => !el.isDeleted);
    const { elements, changed } = mergeFullScene(s.elements, incoming);
    if (!changed.size && elements.length === s.elements.length) {
      this.applyRemoteBg(canvasBg);
      return;
    }
    clearShapeCache();
    for (const el of elements) {
      if (changed.has(el.id)) this.sentVersions.set(el.id, el.version);
    }
    this.lastSentBg = canvasBg;
    s.replaceElements(elements);
    s.setCanvasBg(canvasBg);
    s.clearSelection();
    history.reset();
    if (wasEmpty) zoomToFit();
  }

  private async loadServerSnapshot() {
    if (!this.roomId || !this.keys) return;
    try {
      const snapshot = await api.getRoomSnapshot(this.roomId, this.keys.verifier);
      const plain = await decryptString(this.keys.key, snapshot.encData);
      const parsed = parseSceneFile(plain);
      this.applyRemoteScene(parsed.elements, parsed.canvasBg);
    } catch {
      void 0;
    }
  }

  private attachStoreWatcher() {
    if (this.unsubscribeStore) return;
    let lastNonce = useStore.getState().sceneNonce;
    let lastBg = useStore.getState().canvasBg;
    this.unsubscribeStore = useStore.subscribe((state) => {
      if (state.sceneNonce !== lastNonce || state.canvasBg !== lastBg) {
        lastNonce = state.sceneNonce;
        lastBg = state.canvasBg;
        this.queueBroadcast();
        this.queueSnapshot(SNAPSHOT_DEBOUNCE);
      }
    });
  }

  private queueBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = window.setTimeout(() => {
      this.broadcastTimer = null;
      void this.flushBroadcast();
    }, BROADCAST_INTERVAL);
  }

  private async flushBroadcast() {
    if (!this.isLive()) return;
    const s = useStore.getState();
    const changed = diffSince(s.elements, this.sentVersions);
    const bgChanged = s.canvasBg !== this.lastSentBg;
    if (!changed.length && !bgChanged) return;
    for (const el of changed) this.sentVersions.set(el.id, el.version);
    this.lastSentBg = s.canvasBg;
    await this.sendWire({
      k: "update",
      elements: JSON.parse(JSON.stringify(changed)) as LakarElement[],
      canvasBg: bgChanged ? s.canvasBg : undefined,
    });
  }

  onPointerMove(point: Point) {
    this.lastPoint = point;
    this.queuePointer();
  }

  onSelectionChanged() {
    if (!this.lastPoint) return;
    this.queuePointer();
  }

  private queuePointer() {
    if (!this.isLive() || !this.lastPoint) return;
    const s = useStore.getState();
    this.pointerPending = {
      k: "pointer",
      x: Math.round(this.lastPoint.x * 10) / 10,
      y: Math.round(this.lastPoint.y * 10) / 10,
      tool: s.activeTool,
      selectedIds: [...s.selectedIds].slice(0, 200),
    };
    if (this.pointerTimer) return;
    this.pointerTimer = window.setTimeout(() => {
      this.pointerTimer = null;
      const payload = this.pointerPending;
      this.pointerPending = null;
      if (payload) void this.sendWire(payload);
    }, POINTER_INTERVAL);
  }

  private queueSnapshot(delay: number) {
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;
      void this.uploadSnapshot();
    }, delay);
  }

  private isSnapshotLeader() {
    if (!this.selfId) return false;
    const ids = [...this.peerMeta.keys()].sort();
    return ids[0] === this.selfId;
  }

  private async uploadSnapshot() {
    if (!this.isLive() || !this.roomId || !this.keys) return;
    if (!this.isSnapshotLeader()) return;
    const s = useStore.getState();
    try {
      const doc = serializeScene(s.elements, s.canvasBg);
      const encData = await encryptString(this.keys.key, JSON.stringify(doc));
      await api.putRoomSnapshot(this.roomId, this.keys.verifier, encData);
    } catch {
      void 0;
    }
  }

  private startSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = window.setInterval(() => {
      presence.pruneStale();
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ t: "ping" }));
      }
    }, PRESENCE_SWEEP);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.roomId) return;
    const s = useStore.getState();
    if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
      s.setCollab({ status: "ended" });
      s.toast("Lost the live session — the connection dropped", "error");
      void this.teardown(false);
      return;
    }
    s.setCollab({ status: "reconnecting" });
    presence.clear();
    const delay = RECONNECT_DELAYS[this.reconnectAttempt++];
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.peerMeta.clear();
      this.askedPeers.clear();
      this.sentVersions.clear();
      this.lastSentBg = null;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private async handleRoomClosed() {
    if (this.leaving || !this.roomId) return;
    useStore.getState().toast("The host ended this live session", "info");
    await this.leave({ silent: true });
  }

  async endForEveryone() {
    if (!this.roomId || !this.ownerToken) return;
    this.leaving = true;
    try {
      await api.endRoom(this.roomId, this.ownerToken);
    } catch (err) {
      this.leaving = false;
      if (!(err instanceof ApiError) || err.status !== 404) {
        useStore.getState().toast("Could not end the session", "error");
        return;
      }
    }
    await this.leave({ silent: true });
  }

  async leave({ silent = false }: { silent?: boolean } = {}) {
    if (!this.roomId) return;
    this.leaving = true;
    const wasGuest = !this.isHost;
    if (this.isLive()) await this.sendWire({ k: "bye" });
    await this.teardown(true);
    if (wasGuest) {
      useStore.getState().setDialog("keep-collab-copy");
    } else if (!silent) {
      useStore.getState().toast("Live session ended", "info");
    }
  }

  private async teardown(intentional: boolean) {
    this.intentionalClose = intentional;
    if (this.broadcastTimer) window.clearTimeout(this.broadcastTimer);
    if (this.pointerTimer) window.clearTimeout(this.pointerTimer);
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.sweepTimer) window.clearInterval(this.sweepTimer);
    this.broadcastTimer = null;
    this.pointerTimer = null;
    this.snapshotTimer = null;
    this.reconnectTimer = null;
    this.sweepTimer = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.socket?.close();
    this.socket = null;
    this.keys = null;
    this.roomId = null;
    this.secret = null;
    this.ownerToken = null;
    this.selfId = null;
    this.leaving = false;
    this.reconnectAttempt = 0;
    this.peerMeta.clear();
    this.askedPeers.clear();
    this.sentVersions.clear();
    this.lastSentBg = null;
    this.lastPoint = null;
    this.pointerPending = null;
    presence.clear();
    clearRoomHash();
    useStore.getState().setCollab(IDLE_COLLAB);
  }

  async discardRoomScene() {
    await syncManager.exitRoomScene();
  }

  async keepRoomSceneCopy(title: string) {
    const ok = await syncManager.saveRoomSceneAsCopy(title);
    await syncManager.exitRoomScene();
    return ok;
  }
}

export const collab = new CollabManager();
