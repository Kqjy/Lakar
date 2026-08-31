import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { stmts } from "./db.js";

const MAX_PEERS_PER_ROOM = 32;
const MAX_ROOMS = 20_000;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;
const ROOM_TTL_MS = 1000 * 60 * 60 * 24 * 21;
const PRUNE_INTERVAL_MS = 1000 * 60 * 60;
const HEARTBEAT_MS = 30_000;
const BUCKET_CAPACITY = 300;
const BUCKET_REFILL_PER_SEC = 150;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const constantTimeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export const isValidRoomId = (id) =>
  typeof id === "string" && /^[A-Za-z0-9_-]{16,32}$/.test(id);

export const isValidVerifier = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{40,50}$/.test(v);

const isValidSnapshot = (c) =>
  typeof c === "string" &&
  c.length <= MAX_SNAPSHOT_BYTES &&
  /^v1z?\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(c);

const roomPeers = new Map();

const peersOf = (roomId) => roomPeers.get(roomId) ?? new Map();

const send = (socket, payload) => {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
};

const broadcast = (roomId, payload, exceptId = null) => {
  for (const [id, socket] of peersOf(roomId)) {
    if (id === exceptId) continue;
    send(socket, payload);
  }
};

const detach = (socket) => {
  const { roomId, clientId } = socket.lakar ?? {};
  if (!roomId || !clientId) return;
  const peers = roomPeers.get(roomId);
  if (!peers) return;
  peers.delete(clientId);
  if (peers.size === 0) roomPeers.delete(roomId);
  else broadcast(roomId, { t: "peer-leave", id: clientId });
};

const takeToken = (socket) => {
  const now = Date.now();
  const state = socket.lakar;
  const elapsed = (now - state.bucketAt) / 1000;
  state.bucketAt = now;
  state.tokens = Math.min(
    BUCKET_CAPACITY,
    state.tokens + elapsed * BUCKET_REFILL_PER_SEC,
  );
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
};

const handleJoin = (socket, message) => {
  const state = socket.lakar;
  if (state.roomId) {
    send(socket, { t: "error", code: "already-joined" });
    return;
  }
  if (!isValidRoomId(message.room) || !isValidVerifier(message.verifier)) {
    send(socket, { t: "error", code: "bad-request" });
    socket.close(4000, "bad-request");
    return;
  }
  const room = stmts.roomById.get(message.room);
  if (!room) {
    send(socket, { t: "error", code: "no-room" });
    socket.close(4004, "no-room");
    return;
  }
  if (!constantTimeEqual(sha256(message.verifier), room.verifier_hash)) {
    send(socket, { t: "error", code: "denied" });
    socket.close(4003, "denied");
    return;
  }
  const peers = roomPeers.get(message.room) ?? new Map();
  if (peers.size >= MAX_PEERS_PER_ROOM) {
    send(socket, { t: "error", code: "room-full" });
    socket.close(4008, "room-full");
    return;
  }
  const clientId = randomBytes(9).toString("base64url");
  state.roomId = message.room;
  state.clientId = clientId;
  peers.set(clientId, socket);
  roomPeers.set(message.room, peers);
  stmts.touchRoom.run(Date.now(), message.room);

  send(socket, {
    t: "joined",
    id: clientId,
    peers: [...peers.keys()].filter((id) => id !== clientId),
    hasSnapshot: !!room.enc_snapshot,
  });
  broadcast(message.room, { t: "peer-join", id: clientId }, clientId);
};

const handleRelay = (socket, message) => {
  const { roomId, clientId } = socket.lakar;
  if (!roomId || typeof message.d !== "string") return;
  const envelope = { t: "msg", from: clientId, d: message.d };
  if (typeof message.to === "string") {
    const target = peersOf(roomId).get(message.to);
    if (target) send(target, envelope);
    return;
  }
  broadcast(roomId, envelope, clientId);
};

export const attachRoomSocket = (server) => {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });

  wss.on("connection", (socket) => {
    socket.lakar = {
      roomId: null,
      clientId: null,
      alive: true,
      tokens: BUCKET_CAPACITY,
      bucketAt: Date.now(),
    };

    socket.on("pong", () => {
      socket.lakar.alive = true;
    });

    socket.on("message", (raw) => {
      if (!takeToken(socket)) {
        socket.close(4029, "rate-limited");
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.t === "join") handleJoin(socket, message);
      else if (message.t === "msg") handleRelay(socket, message);
      else if (message.t === "ping") send(socket, { t: "pong" });
    });

    socket.on("close", () => detach(socket));
    socket.on("error", () => detach(socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.lakar?.alive) {
        socket.terminate();
        continue;
      }
      socket.lakar.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const prune = setInterval(() => {
    stmts.pruneRooms.run(Date.now() - ROOM_TTL_MS);
  }, PRUNE_INTERVAL_MS);
  prune.unref?.();

  return wss;
};

export const closeRoomSockets = (roomId, reason) => {
  for (const socket of peersOf(roomId).values()) {
    send(socket, { t: "room-closed", reason });
    socket.close(4001, "room-closed");
  }
  roomPeers.delete(roomId);
};

export const registerRoomRoutes = (app, { bad, rateLimit }) => {
  app.post("/api/rooms", rateLimit(30, 10 * 60 * 1000), (req, res) => {
    const { roomId, verifier, mode } = req.body ?? {};
    if (!isValidRoomId(roomId) || !isValidVerifier(verifier)) {
      return bad(res, 400, "invalid-room", "Malformed session request");
    }
    if (mode !== "link" && mode !== "password") {
      return bad(res, 400, "invalid-mode", "Unknown session mode");
    }
    if (stmts.roomById.get(roomId)) {
      return bad(res, 409, "room-exists", "That session already exists");
    }
    if (stmts.countRooms.get().n >= MAX_ROOMS) {
      stmts.pruneRooms.run(Date.now() - ROOM_TTL_MS);
      if (stmts.countRooms.get().n >= MAX_ROOMS) {
        return bad(res, 503, "capacity", "Too many live sessions right now");
      }
    }
    const ownerToken = randomBytes(24).toString("base64url");
    const now = Date.now();
    stmts.createRoom.run(
      roomId,
      mode,
      sha256(verifier),
      sha256(ownerToken),
      now,
      now,
    );
    res.status(201).json({ roomId, mode, ownerToken });
  });

  app.get("/api/rooms/:id", rateLimit(240, 10 * 60 * 1000), (req, res) => {
    if (!isValidRoomId(req.params.id)) {
      return bad(res, 400, "invalid-room", "Malformed session id");
    }
    const room = stmts.roomById.get(req.params.id);
    if (!room) return bad(res, 404, "no-room", "This session has ended");
    res.json({
      roomId: room.id,
      mode: room.mode,
      peers: peersOf(room.id).size,
      hasSnapshot: !!room.enc_snapshot,
    });
  });

  const requireMember = (req, res) => {
    if (!isValidRoomId(req.params.id)) {
      bad(res, 400, "invalid-room", "Malformed session id");
      return null;
    }
    const room = stmts.roomById.get(req.params.id);
    if (!room) {
      bad(res, 404, "no-room", "This session has ended");
      return null;
    }
    const verifier = req.get("x-room-verifier");
    if (!isValidVerifier(verifier) || !constantTimeEqual(sha256(verifier), room.verifier_hash)) {
      bad(res, 403, "denied", "Wrong session key");
      return null;
    }
    return room;
  };

  app.get("/api/rooms/:id/snapshot", (req, res) => {
    const room = requireMember(req, res);
    if (!room) return;
    if (!room.enc_snapshot) {
      return bad(res, 404, "no-snapshot", "No saved snapshot yet");
    }
    res.json({ encData: room.enc_snapshot, updatedAt: room.updated_at });
  });

  app.put("/api/rooms/:id/snapshot", (req, res) => {
    const room = requireMember(req, res);
    if (!room) return;
    const { encData } = req.body ?? {};
    if (!isValidSnapshot(encData)) {
      return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
    }
    stmts.saveRoomSnapshot.run(encData, Date.now(), room.id);
    res.status(204).end();
  });

  app.delete("/api/rooms/:id", (req, res) => {
    if (!isValidRoomId(req.params.id)) {
      return bad(res, 400, "invalid-room", "Malformed session id");
    }
    const room = stmts.roomById.get(req.params.id);
    if (!room) return res.status(204).end();
    const ownerToken = req.get("x-owner-token") ?? "";
    if (!constantTimeEqual(sha256(ownerToken), room.owner_hash)) {
      return bad(res, 403, "denied", "Only the host can end this session");
    }
    stmts.deleteRoom.run(room.id);
    closeRoomSockets(room.id, "ended");
    res.status(204).end();
  });
};
