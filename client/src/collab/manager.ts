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
const SCENE_ASK_TIMEOUT = 4000;
const CHUNK_CHARS = 512 * 1024;
const CHUNK_BURST = 48;
const CHUNK_PAUSE = 400;
const CHUNK_TTL = 90_000;
const MAX_INBOUND_CHARS = 64 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_INBOUND_CHARS / CHUNK_CHARS);
const MAX_INBOUND_MESSAGES = 16;
const MAX_CHUNK_ID = 64;
const MAX_SNAPSHOT_CHARS = 12 * 1024 * 1024;
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
  | {
      k: "update";
      elements: LakarElement[];
      canvasBg?: WireReg;
      title?: WireReg;
    }
  | { k: "ask-scene" }
  | {
      k: "scene";
      elements: LakarElement[];
      canvasBg: WireReg;
      title?: WireReg;
    }
  | { k: "bye" };

interface Reg {
  text: string;
  version: number;
  nonce: number;
}

type WireReg = Reg | string;

const newNonce = () => Math.floor(Math.random() * 0x7fffffff);

const asReg = (value: WireReg): Reg | null => {
  if (typeof value === "string") {
    return value ? { text: value, version: -1, nonce: 0 } : null;
  }
  if (
    !value ||
    typeof value.text !== "string" ||
    !value.text ||
    !Number.isInteger(value.version) ||
    !Number.isInteger(value.nonce)
  ) {
    return null;
  }
  return { text: value.text, version: value.version, nonce: value.nonce };
};

const regWins = (local: Reg | null, remote: Reg): boolean => {
  if (!local) return true;
  if (remote.version === -1) return true;
  if (remote.version !== local.version) return remote.version > local.version;
  return remote.nonce < local.nonce;
};

const bumped = (local: Reg | null, text: string): Reg => ({
  text,
  version: Math.max(0, local?.version ?? 0) + 1,
  nonce: newNonce(),
});

interface ChunkBuffer {
  total: number;
  parts: (string | null)[];
  received: number;
  chars: number;
  updatedAt: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

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
  private bgReg: Reg | null = null;
  private titleReg: Reg | null = null;
  private sceneReady = false;
  private askTimer: number | null = null;
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
  private inbound = new Map<string, ChunkBuffer>();
  private outboundSeq = 0;
  private sendChain: Promise<void> = Promise.resolve();
  private servingScene = new Set<string>();
  private generation = 0;
  private snapshotWarned = false;
  private regResend = false;
  private sceneWarned = false;

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
    await syncManager.enterRoomScene(roomId, s.sceneTitle);
    this.resetOutbound();
    this.sceneReady = true;
    try {
      await this.connect();
    } catch (err) {
      await this.abortConnect(true);
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
    this.sceneReady = false;
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
    this.sceneReady = false;

    try {
      await this.connect();
    } catch (err) {
      await this.abortConnect(true);
      throw err;
    }
    writeRoomHash(roomId, this.secret);

    if (info.peers === 0) {
      this.sceneReady = await this.loadServerSnapshot();
      if (!this.sceneReady) this.warnSceneUnavailable();
    }
  }

  private resetOutbound() {
    this.sentVersions.clear();
    this.bgReg = null;
    this.titleReg = null;
    this.askedPeers.clear();
    this.peerMeta.clear();
    this.inbound.clear();
    this.servingScene.clear();
    presence.clear();
  }

  private connect(): Promise<void> {
    this.generation++;
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
    for (const id of message.peers) {
      if (this.peerMeta.has(id)) continue;
      this.peerMeta.set(id, {
        id,
        name: "Guest",
        color: colorFor(id),
        isSelf: false,
        joinedAt: Date.now(),
      });
    }
    s.setCollab({ status: "live", peers: this.peerList() });

    void this.sendWire(this.helloPayload());

    if (this.sceneReady) {
      void this.flushBroadcast();
    } else {
      this.askScene();
    }

    this.attachStoreWatcher();
    this.startSweep();
  }

  private askScene() {
    if (this.sceneReady || !this.isLive()) return;
    const next = [...this.peerMeta.keys()].find(
      (id) => id !== this.selfId && !this.askedPeers.has(id),
    );
    if (!next) {
      void this.loadServerSnapshot().then((ok) => {
        if (this.sceneReady || !this.isLive()) return;
        if (ok) {
          this.sceneReady = true;
          return;
        }
        this.warnSceneUnavailable();
      });
      return;
    }
    this.askedPeers.add(next);
    void this.sendWire({ k: "ask-scene" }, next);
    if (this.askTimer) window.clearTimeout(this.askTimer);
    this.askTimer = window.setTimeout(() => {
      this.askTimer = null;
      this.askScene();
    }, SCENE_ASK_TIMEOUT);
  }

  private warnSceneUnavailable() {
    if (this.sceneWarned) return;
    this.sceneWarned = true;
    useStore
      .getState()
      .toast(
        "Could not load this canvas yet — waiting for someone who has it",
        "error",
      );
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
    this.servingScene.delete(id);
    for (const key of this.inbound.keys()) {
      if (key.startsWith(`${id}:`)) this.inbound.delete(key);
    }
    presence.remove(id);
    useStore.getState().setCollab({ peers: this.peerList() });
  }

  private async sendWire(payload: Wire, to?: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.keys) {
      return;
    }
    let cipher: string;
    try {
      cipher = await encryptString(this.keys.key, JSON.stringify(payload));
    } catch {
      return;
    }
    if (cipher.length <= CHUNK_CHARS) {
      this.rawSend(cipher, to);
      return;
    }
    const total = Math.ceil(cipher.length / CHUNK_CHARS);
    const id = `${this.selfId ?? "s"}${this.outboundSeq++}`;
    const socket = this.socket;
    const generation = this.generation;
    const run = this.sendChain.then(async () => {
      for (let i = 0; i < total; i++) {
        if (this.generation !== generation || this.socket !== socket) return;
        if (!this.isLive()) return;
        const part = cipher.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
        this.rawSend(`x1.${id}.${i}.${total}.${part}`, to);
        if (i > 0 && i % CHUNK_BURST === 0) await sleep(CHUNK_PAUSE);
      }
    });
    this.sendChain = run.catch(() => undefined);
    await run;
  }

  private rawSend(d: string, to?: string) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(to ? { t: "msg", to, d } : { t: "msg", d }));
    } catch {
      void 0;
    }
  }

  private reassemble(from: string, d: string): string | null {
    if (!d.startsWith("x1.")) return d;
    const head = d.indexOf(".", 3);
    const mid = head < 0 ? -1 : d.indexOf(".", head + 1);
    const tail = mid < 0 ? -1 : d.indexOf(".", mid + 1);
    if (tail < 0) return null;
    const id = d.slice(3, head);
    const index = Number(d.slice(head + 1, mid));
    const total = Number(d.slice(mid + 1, tail));
    const part = d.slice(tail + 1);
    if (
      !id ||
      id.length > MAX_CHUNK_ID ||
      !/^[A-Za-z0-9_-]+$/.test(id) ||
      !Number.isInteger(index) ||
      !Number.isInteger(total) ||
      total < 1 ||
      total > MAX_CHUNKS ||
      index < 0 ||
      index >= total ||
      part.length > CHUNK_CHARS
    ) {
      return null;
    }

    const key = `${from}:${id}`;
    let buf = this.inbound.get(key);
    if (!buf) {
      if (this.inbound.size >= MAX_INBOUND_MESSAGES) return null;
      if (this.bufferedChars() + part.length > MAX_INBOUND_CHARS) return null;
      buf = {
        total,
        parts: new Array<string | null>(total).fill(null),
        received: 0,
        chars: 0,
        updatedAt: Date.now(),
      };
      this.inbound.set(key, buf);
    }
    if (buf.total !== total || buf.parts[index] !== null) return null;
    if (this.bufferedChars() + part.length > MAX_INBOUND_CHARS) {
      this.inbound.delete(key);
      return null;
    }
    buf.parts[index] = part;
    buf.received++;
    buf.chars += part.length;
    buf.updatedAt = Date.now();
    if (buf.received !== buf.total) return null;
    this.inbound.delete(key);
    return buf.parts.join("");
  }

  private bufferedChars() {
    let total = 0;
    for (const buf of this.inbound.values()) total += buf.chars;
    return total;
  }

  private pruneChunks() {
    const cutoff = Date.now() - CHUNK_TTL;
    for (const [key, buf] of this.inbound) {
      if (buf.updatedAt < cutoff) this.inbound.delete(key);
    }
  }

  private async onWire(from: string, framed: string) {
    if (!this.keys) return;
    const ciphertext = this.reassemble(from, framed);
    if (ciphertext === null) return;
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
        if (!this.sceneReady && !this.askTimer) this.askScene();
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
        if (payload.title) this.applyRemoteTitle(payload.title);
        break;
      }
      case "ask-scene": {
        if (!this.sceneReady || this.servingScene.has(from)) break;
        this.servingScene.add(from);
        try {
          const current = useStore.getState();
          await this.sendWire(
            {
              k: "scene",
              elements: JSON.parse(
                JSON.stringify(current.elements),
              ) as LakarElement[],
              canvasBg: this.bgReg ?? current.canvasBg,
              title: this.titleReg ?? current.sceneTitle,
            },
            from,
          );
        } finally {
          this.servingScene.delete(from);
        }
        break;
      }
      case "scene": {
        if (this.askTimer) {
          window.clearTimeout(this.askTimer);
          this.askTimer = null;
        }
        this.sceneReady = true;
        this.sceneWarned = false;
        this.applyRemoteScene(payload.elements, payload.canvasBg, payload.title);
        break;
      }
      case "bye": {
        this.dropPeer(from);
        break;
      }
    }
  }

  private applyRemoteElements(incoming: LakarElement[], canvasBg?: WireReg) {
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

  private applyRemoteBg(canvasBg: WireReg) {
    const remote = asReg(canvasBg);
    if (!remote) return;
    if (regWins(this.bgReg, remote)) {
      this.adoptBg(remote);
      return;
    }
    if (this.bgReg && this.bgReg.text !== remote.text && regWins(remote, this.bgReg)) {
      this.scheduleRegResend();
    }
  }

  private adoptBg(remote: Reg) {
    this.bgReg =
      remote.version === -1
        ? bumped(this.bgReg, remote.text)
        : { ...remote };
    const s = useStore.getState();
    if (s.canvasBg !== this.bgReg.text) s.setCanvasBg(this.bgReg.text);
  }

  private applyRemoteTitle(title: WireReg) {
    const remote = asReg(title);
    if (!remote) return;
    if (regWins(this.titleReg, remote)) {
      this.adoptTitle(remote);
      return;
    }
    if (
      this.titleReg &&
      this.titleReg.text !== remote.text &&
      regWins(remote, this.titleReg)
    ) {
      this.scheduleRegResend();
    }
  }

  private scheduleRegResend() {
    this.regResend = true;
    this.queueBroadcast();
  }

  private adoptTitle(remote: Reg) {
    const text = remote.text.trim().slice(0, 120);
    if (!text) return;
    this.titleReg =
      remote.version === -1
        ? bumped(this.titleReg, text)
        : { ...remote, text };
    const s = useStore.getState();
    if (s.sceneTitle !== text) s.setSceneTitle(text);
  }

  private applyRemoteScene(
    incoming: LakarElement[],
    canvasBg: WireReg,
    title?: WireReg | null,
  ) {
    if (!Array.isArray(incoming)) return;
    const s = useStore.getState();
    const titleReg = title == null ? null : asReg(title);
    if (titleReg) this.adoptTitle(titleReg);
    const bgReg = asReg(canvasBg);
    const wasEmpty = !s.elements.some((el) => !el.isDeleted);
    const { elements, changed } = mergeFullScene(s.elements, incoming);
    if (!changed.size && elements.length === s.elements.length) {
      if (bgReg) this.adoptBg(bgReg);
      return;
    }
    clearShapeCache();
    for (const el of elements) {
      if (changed.has(el.id)) this.sentVersions.set(el.id, el.version);
    }
    s.replaceElements(elements);
    if (bgReg) this.adoptBg(bgReg);
    s.clearSelection();
    history.reset();
    if (wasEmpty) zoomToFit();
  }

  private async loadServerSnapshot(): Promise<boolean> {
    if (!this.roomId || !this.keys) return false;
    try {
      const snapshot = await api.getRoomSnapshot(this.roomId, this.keys.verifier);
      const plain = await decryptString(this.keys.key, snapshot.encData);
      const parsed = parseSceneFile(plain);
      this.applyRemoteScene(parsed.elements, parsed.canvasBg, parsed.title);
      return true;
    } catch (err) {
      return err instanceof ApiError && err.status === 404;
    }
  }

  private attachStoreWatcher() {
    if (this.unsubscribeStore) return;
    let lastNonce = useStore.getState().sceneNonce;
    let lastBg = useStore.getState().canvasBg;
    let lastTitle = useStore.getState().sceneTitle;
    this.unsubscribeStore = useStore.subscribe((state) => {
      if (
        state.sceneNonce !== lastNonce ||
        state.canvasBg !== lastBg ||
        state.sceneTitle !== lastTitle
      ) {
        lastNonce = state.sceneNonce;
        lastBg = state.canvasBg;
        lastTitle = state.sceneTitle;
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
    const title = s.sceneTitle.trim().slice(0, 120);
    const bgChanged = s.canvasBg !== this.bgReg?.text;
    const titleChanged = !!title && title !== this.titleReg?.text;
    const resend = this.regResend;
    this.regResend = false;
    if (!changed.length && !bgChanged && !titleChanged && !resend) return;
    for (const el of changed) this.sentVersions.set(el.id, el.version);
    if (bgChanged) this.bgReg = bumped(this.bgReg, s.canvasBg);
    if (titleChanged) this.titleReg = bumped(this.titleReg, title);
    await this.sendWire({
      k: "update",
      elements: JSON.parse(JSON.stringify(changed)) as LakarElement[],
      canvasBg: bgChanged || resend ? this.bgReg ?? undefined : undefined,
      title: titleChanged || resend ? this.titleReg ?? undefined : undefined,
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
    if (!this.sceneReady) return;
    if (!this.isSnapshotLeader()) return;
    const s = useStore.getState();
    try {
      const doc = serializeScene(s.elements, s.canvasBg, s.sceneTitle);
      const encData = await encryptString(this.keys.key, JSON.stringify(doc));
      if (encData.length > MAX_SNAPSHOT_CHARS) {
        this.warnSnapshotTooBig();
        return;
      }
      await api.putRoomSnapshot(this.roomId, this.keys.verifier, encData);
      this.snapshotWarned = false;
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        this.warnSnapshotTooBig();
      }
    }
  }

  private warnSnapshotTooBig() {
    if (this.snapshotWarned) return;
    this.snapshotWarned = true;
    useStore
      .getState()
      .toast(
        "This canvas is too big to keep on the server — it now lives only in the browsers of everyone here, so save a copy before you all leave",
        "error",
      );
  }

  private startSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = window.setInterval(() => {
      presence.pruneStale();
      this.pruneChunks();
      if (!this.sceneReady && !this.askTimer) {
        this.askedPeers.clear();
        this.askScene();
      }
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
      void this.teardown(false).then(() => {
        useStore.getState().setDialog("keep-collab-copy");
      });
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
      this.bgReg = null;
      this.titleReg = null;
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
    if (this.isLive()) await this.sendWire({ k: "bye" });
    await this.teardown(true);
    useStore.getState().setDialog("keep-collab-copy");
    if (silent) return;
    useStore.getState().toast("You left the live session", "info");
  }

  private async teardown(intentional: boolean) {
    this.generation++;
    this.intentionalClose = intentional;
    if (this.broadcastTimer) window.clearTimeout(this.broadcastTimer);
    if (this.pointerTimer) window.clearTimeout(this.pointerTimer);
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.askTimer) window.clearTimeout(this.askTimer);
    if (this.sweepTimer) window.clearInterval(this.sweepTimer);
    this.broadcastTimer = null;
    this.pointerTimer = null;
    this.snapshotTimer = null;
    this.reconnectTimer = null;
    this.askTimer = null;
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
    this.bgReg = null;
    this.titleReg = null;
    this.sceneReady = false;
    this.snapshotWarned = false;
    this.sceneWarned = false;
    this.regResend = false;
    this.lastPoint = null;
    this.pointerPending = null;
    this.inbound.clear();
    this.servingScene.clear();
    presence.clear();
    clearRoomHash();
    useStore.getState().setCollab(IDLE_COLLAB);
  }

  async discardRoomScene() {
    await syncManager.exitRoomScene();
  }

  async keepRoomSceneCopy(title: string) {
    const ok = await syncManager.saveRoomSceneAsCopy(title);
    if (ok) await syncManager.exitRoomScene();
    return ok;
  }
}

export const collab = new CollabManager();
