import express from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, stmts, transaction } from "./db.js";
import {
  authMiddleware,
  hashAuthKey,
  issueToken,
  newId,
  rateLimit,
  requireScope,
  verifyAuthKey,
} from "./auth.js";
import { claimInvite, inviteIsOpen, invitesRequired } from "./invites.js";
import { attachRoomSocket, registerRoomRoutes } from "./rooms.js";
import {
  expectedRpId,
  isValidB64,
  isValidCredentialId,
  issueChallenge,
  verifyAssertion,
  verifyRegistration,
} from "./webauthn.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5191;
const MAX_SCENE_BYTES = 12 * 1024 * 1024;
const MAX_SCENES_PER_USER = 1000;
const MAX_FOLDERS_PER_USER = 200;
const MAX_SATCHEL_BYTES = 2 * 1024 * 1024;
const MAX_SATCHEL_PER_USER = 500;
const MAX_PUBLISHED_PER_USER = 100;
const MAX_PUBLISHED_BYTES_PER_USER = 256 * 1024 * 1024;

const quotaBytes = () => {
  const mb = Number(process.env.LAKAR_QUOTA_MB);
  return Number.isInteger(mb) && mb > 0 ? mb * 1024 * 1024 : null;
};

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1");
app.use(express.json({ limit: "16mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const bad = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidAuthKey = (k) =>
  typeof k === "string" && /^[A-Za-z0-9_-]{40,50}$/.test(k);
const b64urlLength = (s) => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return -1;
  const rem = s.length % 4;
  if (rem === 1) return -1;
  return Math.floor((s.length * 3) / 4);
};

const isValidCiphertext = (c) => {
  if (typeof c !== "string") return false;
  const parts = c.split(".");
  if (parts.length === 3) {
    const [prefix, iv, ct] = parts;
    if (prefix !== "v1" && prefix !== "v1z") return false;
    if (b64urlLength(iv) !== 12) return false;
    return b64urlLength(ct) >= 16;
  }
  if (parts.length === 4) {
    const [prefix, epoch, iv, ct] = parts;
    if (prefix !== "v2" && prefix !== "v2z") return false;
    if (!/^\d{1,9}$/.test(epoch)) return false;
    if (b64urlLength(iv) !== 12) return false;
    return b64urlLength(ct) >= 16;
  }
  return false;
};

const isWrapped = (s) =>
  typeof s === "string" && /^[A-Za-z0-9_-]{40,200}$/.test(s);
const isTaggedBlob = (prefix) => (s) =>
  typeof s === "string" &&
  s.length <= 400 &&
  new RegExp(`^${prefix}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`).test(s);
const isWrappedDataKey = isTaggedBlob("w1");
const isCheckBlob = isTaggedBlob("c1");
const isEpoch = (n) => Number.isInteger(n) && n >= 0 && n <= 1e9;

const WRAP_KINDS = new Set(["password", "recovery"]);

const isValidWrap = (w) =>
  !!w &&
  typeof w === "object" &&
  WRAP_KINDS.has(w.kind) &&
  (w.slot === undefined || (typeof w.slot === "string" && w.slot.length <= 256)) &&
  isWrapped(w.wrapped) &&
  (w.params === undefined ||
    (typeof w.params === "string" && w.params.length <= 1024)) &&
  (w.label === undefined ||
    w.label === null ||
    (typeof w.label === "string" && w.label.length <= 64));

const isValidDataKey = (d) =>
  !!d &&
  typeof d === "object" &&
  isEpoch(d.epoch) &&
  isWrappedDataKey(d.wrapped) &&
  isCheckBlob(d.dkCheck);

const keyStateFor = (user) => ({
  userId: user.id,
  wraps: stmts.listWraps.all(user.id),
  dataKeys: stmts.listDataKeys.all(user.id),
  writeEpoch: user.write_epoch,
  arkCheck: user.ark_check,
  hasRecovery: !!user.recovery_hash,
});

class InviteTakenError extends Error {}

class KeyChangeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const applyKeyChange = (user, body) => {
  const { newAuthKey, wraps, removeWraps, recoveryAuthKey, arkCheck, dataKeys, writeEpoch } =
    body;
  return transaction(() => {
    if (body.expectNoHierarchy) {
      const current = stmts.userById.get(user.id);
      const hasPassword = stmts.wrapByKind.get(user.id, "password", "");
      if (current.ark_check || hasPassword) {
        throw new KeyChangeError(
          409,
          "hierarchy-exists",
          "This account was already set up elsewhere",
        );
      }
    }
    if (arkCheck !== undefined) {
      stmts.setArkCheck.run(arkCheck, user.id);
    }
    for (const d of dataKeys ?? []) {
      const existing = stmts.dataKeyByEpoch.get(user.id, d.epoch);
      if (existing && existing.wrapped !== d.wrapped) {
        throw new KeyChangeError(
          409,
          "epoch-exists",
          "That data key epoch already exists",
        );
      }
      stmts.putDataKey.run(user.id, d.epoch, d.wrapped, d.dkCheck, Date.now());
    }
    if (writeEpoch !== undefined) {
      stmts.setWriteEpoch.run(writeEpoch, user.id);
    }
    for (const w of wraps ?? []) {
      stmts.putWrap.run(
        user.id,
        w.kind,
        w.slot ?? "",
        w.wrapped,
        w.params ?? "{}",
        w.label ?? null,
        Date.now(),
      );
    }
    for (const w of removeWraps ?? []) {
      stmts.deleteWrap.run(user.id, w.kind, w.slot ?? "");
    }
    if (recoveryAuthKey !== undefined) {
      const hadRecovery = !!stmts.userById.get(user.id).recovery_hash;
      const { salt, hash } = hashAuthKey(recoveryAuthKey);
      stmts.setRecovery.run(hash, salt, user.id);
      if (hadRecovery && newAuthKey === undefined) {
        stmts.bumpTokenVersion.run(user.id);
      }
    }
    if (newAuthKey !== undefined) {
      const { salt, hash } = hashAuthKey(newAuthKey);
      stmts.setAuth.run(hash, salt, user.id); 
    }

    const fresh = stmts.userById.get(user.id);
    const epochs = stmts.listDataKeys.all(user.id).map((d) => d.epoch);
    if (epochs.length && !epochs.includes(fresh.write_epoch)) {
      throw new KeyChangeError(
        400,
        "invalid-write-epoch",
        "That write epoch has no data key",
      );
    }
    if (epochs.length && !stmts.wrapByKind.get(user.id, "password", "")) {
      throw new KeyChangeError(
        400,
        "no-password-wrap",
        "An account must keep a way to unlock it",
      );
    }
    return issueToken(fresh.id, fresh.email, fresh.token_version);
  });
};

const validateKeyChange = (body) => {
  const { newAuthKey, wraps, removeWraps, recoveryAuthKey, arkCheck, dataKeys, writeEpoch } =
    body ?? {};
  if (newAuthKey !== undefined && !isValidAuthKey(newAuthKey)) return "invalid-key";
  if (recoveryAuthKey !== undefined && !isValidAuthKey(recoveryAuthKey)) {
    return "invalid-key";
  }
  if (arkCheck !== undefined && !isCheckBlob(arkCheck)) return "invalid-payload";
  if (writeEpoch !== undefined && !isEpoch(writeEpoch)) return "invalid-payload";
  if (
    body?.expectNoHierarchy !== undefined &&
    typeof body.expectNoHierarchy !== "boolean"
  ) {
    return "invalid-payload";
  }
  if (wraps !== undefined) {
    if (!Array.isArray(wraps) || wraps.length > 32 || !wraps.every(isValidWrap)) {
      return "invalid-payload";
    }
  }
  if (removeWraps !== undefined) {
    if (
      !Array.isArray(removeWraps) ||
      removeWraps.length > 32 ||
      !removeWraps.every((w) => w && WRAP_KINDS.has(w.kind))
    ) {
      return "invalid-payload";
    }
  }
  if (dataKeys !== undefined) {
    if (
      !Array.isArray(dataKeys) ||
      dataKeys.length > 64 ||
      !dataKeys.every(isValidDataKey)
    ) {
      return "invalid-payload";
    }
  }
  return null;
};

app.get("/api/meta", rateLimit(240, 10 * 60 * 1000), (req, res) => {
  res.json({ invitesRequired: invitesRequired() });
});

app.post("/api/auth/register", rateLimit(20, 10 * 60 * 1000), (req, res) => {
  const { email, authKey, inviteCode } = req.body ?? {};
  if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 254) {
    return bad(res, 400, "invalid-email", "Enter a valid email address");
  }
  if (!isValidAuthKey(authKey)) {
    return bad(res, 400, "invalid-key", "Malformed credentials");
  }
  const invalid = validateKeyChange(req.body);
  if (invalid) return bad(res, 400, invalid, "Malformed key material");
  const requestedId = req.body?.userId;
  if (requestedId !== undefined && !/^[A-Za-z0-9-]{16,64}$/.test(String(requestedId))) {
    return bad(res, 400, "invalid-id", "Malformed account id");
  }
  const gated = invitesRequired();
  if (gated && typeof inviteCode !== "string") {
    return bad(
      res,
      403,
      "invite-required",
      "This server is invite-only — enter an invite code",
    );
  }
  if (gated && !inviteIsOpen(inviteCode)) {
    return bad(res, 403, "invite-invalid", "That invite code is not valid");
  }
  const normalized = email.trim().toLowerCase();
  if (stmts.userByEmail.get(normalized)) {
    return bad(res, 409, "email-taken", "An account with this email already exists");
  }
  const id = requestedId ?? newId();
  if (stmts.userById.get(id)) {
    return bad(res, 409, "id-taken", "Please try again");
  }
  const { salt, hash } = hashAuthKey(authKey);
  let token;
  try {
    token = transaction(() => {
      if (gated && !claimInvite(inviteCode, id)) throw new InviteTakenError();
      stmts.createUser.run(id, normalized, hash, salt, Date.now());
      const user = stmts.userById.get(id);
      if (req.body.arkCheck !== undefined) stmts.setArkCheck.run(req.body.arkCheck, id);
      for (const d of req.body.dataKeys ?? []) {
        stmts.putDataKey.run(id, d.epoch, d.wrapped, d.dkCheck, Date.now());
      }
      if (req.body.writeEpoch !== undefined) {
        stmts.setWriteEpoch.run(req.body.writeEpoch, id);
      }
      for (const w of req.body.wraps ?? []) {
        stmts.putWrap.run(
          id,
          w.kind,
          w.slot ?? "",
          w.wrapped,
          w.params ?? "{}",
          w.label ?? null,
          Date.now(),
        );
      }
      if (req.body.recoveryAuthKey !== undefined) {
        const rec = hashAuthKey(req.body.recoveryAuthKey);
        stmts.setRecovery.run(rec.hash, rec.salt, id);
      }
      return issueToken(id, normalized, user.token_version);
    });
  } catch (err) {
    if (err instanceof InviteTakenError) {
      return bad(res, 403, "invite-invalid", "That invite code is not valid");
    }
    throw err;
  }
  const user = stmts.userById.get(id);
  res.status(201).json({ token, email: normalized, ...keyStateFor(user) });
});

app.post("/api/auth/login", rateLimit(20, 10 * 60 * 1000), (req, res) => {
  const { email, authKey } = req.body ?? {};
  if (typeof email !== "string" || !isValidAuthKey(authKey)) {
    return bad(res, 400, "invalid-credentials", "Email or password is incorrect");
  }
  const user = stmts.userByEmail.get(email.trim().toLowerCase());
  if (!user || !verifyAuthKey(authKey, user.auth_salt, user.auth_hash)) {
    return bad(res, 401, "invalid-credentials", "Email or password is incorrect");
  }
  res.json({
    token: issueToken(user.id, user.email, user.token_version),
    email: user.email,
    ...keyStateFor(user),
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ email: req.user.email, ...keyStateFor(req.user) });
});

app.post(
  "/api/auth/reauth",
  authMiddleware,
  rateLimit(20, 10 * 60 * 1000),
  (req, res) => {
    const { authKey } = req.body ?? {};
    if (!isValidAuthKey(authKey)) {
      return bad(res, 400, "invalid-credentials", "Password is incorrect");
    }
    if (!verifyAuthKey(authKey, req.user.auth_salt, req.user.auth_hash)) {
      return bad(res, 401, "invalid-credentials", "Password is incorrect");
    }
    res.json({
      token: issueToken(
        req.user.id,
        req.user.email,
        req.user.token_version,
        "keys",
      ),
    });
  },
);

app.get("/api/keys", authMiddleware, (req, res) => {
  res.json(keyStateFor(req.user));
});

app.post("/api/keys/rewrap", requireScope("keys"), (req, res) => {
  const invalid = validateKeyChange(req.body ?? {});
  if (invalid) return bad(res, 400, invalid, "Malformed key material");
  let token;
  try {
    token = applyKeyChange(req.user, req.body ?? {});
  } catch (err) {
    if (err instanceof KeyChangeError) {
      return bad(res, err.status, err.code, err.message);
    }
    throw err;
  }
  const user = stmts.userById.get(req.user.id);
  res.json({ token, ...keyStateFor(user) });
});

const recoveryBuckets = new Map();
const recoveryAttemptAllowed = (email) => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  if (recoveryBuckets.size > 5000) {
    for (const [k, v] of recoveryBuckets) {
      if (now - v.start > windowMs) recoveryBuckets.delete(k);
    }
  }
  let bucket = recoveryBuckets.get(email);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    recoveryBuckets.set(email, bucket);
  }
  bucket.count += 1;
  return bucket.count <= 10;
};

app.post(
  "/api/auth/recover",
  rateLimit(30, 60 * 60 * 1000),
  (req, res) => {
    const { email, recoveryAuthKey } = req.body ?? {};
    const deny = () =>
      bad(res, 401, "invalid-recovery", "That email and recovery code do not match");
    if (typeof email !== "string" || !isValidAuthKey(recoveryAuthKey)) return deny();
    const normalized = email.trim().toLowerCase();
    if (!recoveryAttemptAllowed(normalized)) {
      return bad(res, 429, "rate-limited", "Too many attempts — try again later");
    }
    const user = stmts.userByEmail.get(normalized);
    if (!user || !user.recovery_hash) {
      hashAuthKey(recoveryAuthKey);
      return deny();
    }
    if (!verifyAuthKey(recoveryAuthKey, user.recovery_salt, user.recovery_hash)) {
      return deny();
    }
    const wrap = stmts.wrapByKind.get(user.id, "recovery", "");
    if (!wrap) return deny();
    res.json({
      token: issueToken(user.id, user.email, user.token_version, "recover"),
      email: user.email,
      wrapped: wrap.wrapped,
      ...keyStateFor(user),
    });
  },
);

app.post("/api/auth/recover/complete", requireScope("recover"), (req, res) => {
  const invalid = validateKeyChange(req.body ?? {});
  if (invalid) return bad(res, 400, invalid, "Malformed key material");
  if (!isValidAuthKey((req.body ?? {}).newAuthKey)) {
    return bad(res, 400, "invalid-key", "Malformed credentials");
  }
  let token;
  try {
    token = applyKeyChange(req.user, req.body);
  } catch (err) {
    if (err instanceof KeyChangeError) {
      return bad(res, err.status, err.code, err.message);
    }
    throw err;
  }
  const user = stmts.userById.get(req.user.id);
  res.json({ token, email: user.email, ...keyStateFor(user) });
});

app.delete("/api/auth/me", authMiddleware, (req, res) => {
  stmts.deleteUser.run(req.user.id);
  res.status(204).end();
});

app.get("/api/scenes", authMiddleware, (req, res) => {
  res.json({
    scenes: stmts.listScenes.all(req.user.id),
    folders: stmts.listFolders.all(req.user.id),
    sceneBytes: stmts.sceneBytes.get(req.user.id).bytes,
    quotaBytes: quotaBytes(),
  });
});

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const overQuota = (userId, freedBytes, addedBytes) => {
  const quota = quotaBytes();
  if (quota === null) return false;
  return stmts.sceneBytes.get(userId).bytes - freedBytes + addedBytes > quota;
};

const quotaFull = (res) =>
  bad(
    res,
    413,
    "quota-exceeded",
    "Storage quota reached — delete some scenes or raise LAKAR_QUOTA_MB",
  );

app.post("/api/scenes", authMiddleware, (req, res) => {
  const { encTitle, encData, folderId, id: clientId } = req.body ?? {};
  if (clientId !== undefined && !CLIENT_ID_RE.test(String(clientId))) {
    return bad(res, 400, "invalid-id", "Malformed scene id");
  }
  if (!isValidCiphertext(encTitle) || !isValidCiphertext(encData)) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (encData.length > MAX_SCENE_BYTES) {
    return bad(res, 413, "too-large", "Scene is too large to sync");
  }
  const count = stmts.countScenes.get(req.user.id).n;
  if (count >= MAX_SCENES_PER_USER) {
    return bad(res, 403, "quota", "Scene limit reached");
  }
  if (overQuota(req.user.id, 0, encData.length)) return quotaFull(res);
  if (folderId != null && !stmts.folderById.get(folderId, req.user.id)) {
    return bad(res, 400, "no-folder", "Folder does not exist");
  }
  const id = clientId ?? newId();
  const now = Date.now();
  try {
    stmts.createScene.run(
      id,
      req.user.id,
      folderId ?? null,
      encTitle,
      encData,
      encData.length,
      now,
      now,
    );
  } catch {
    return bad(res, 409, "exists", "A scene with that id already exists");
  }
  res.status(201).json({ id, version: 1, createdAt: now, updatedAt: now });
});

app.get("/api/scenes/:id", authMiddleware, (req, res) => {
  const scene = stmts.sceneById.get(req.params.id, req.user.id);
  if (!scene) return bad(res, 404, "not-found", "Scene not found");
  res.json({
    id: scene.id,
    folderId: scene.folder_id,
    encTitle: scene.enc_title,
    encData: scene.enc_data,
    version: scene.version,
    size: scene.size,
    createdAt: scene.created_at,
    updatedAt: scene.updated_at,
  });
});

app.put("/api/scenes/:id", authMiddleware, (req, res) => {
  const scene = stmts.sceneById.get(req.params.id, req.user.id);
  if (!scene) return bad(res, 404, "not-found", "Scene not found");
  const { encTitle, encData, folderId, version } = req.body ?? {};
  if (typeof version !== "number" || version !== scene.version) {
    return bad(res, 409, "version-conflict", "Scene was changed elsewhere");
  }
  const nextTitle = encTitle ?? scene.enc_title;
  const nextData = encData ?? scene.enc_data;
  if (!isValidCiphertext(nextTitle) || !isValidCiphertext(nextData)) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (nextData.length > MAX_SCENE_BYTES) {
    return bad(res, 413, "too-large", "Scene is too large to sync");
  }
  if (overQuota(req.user.id, scene.size, nextData.length)) return quotaFull(res);
  let nextFolder = folderId === undefined ? scene.folder_id : folderId;
  if (nextFolder != null && !stmts.folderById.get(nextFolder, req.user.id)) {
    return bad(res, 400, "no-folder", "Folder does not exist");
  }
  const now = Date.now();
  stmts.updateScene.run(
    nextTitle,
    nextData,
    nextFolder,
    nextData.length,
    now,
    req.params.id,
    req.user.id,
  );
  res.json({ version: scene.version + 1, updatedAt: now });
});

app.delete("/api/scenes/:id", authMiddleware, (req, res) => {
  stmts.deleteScene.run(req.params.id, req.user.id);
  res.status(204).end();
});

app.post("/api/folders", authMiddleware, (req, res) => {
  const { encName, id: clientId } = req.body ?? {};
  if (clientId !== undefined && !CLIENT_ID_RE.test(String(clientId))) {
    return bad(res, 400, "invalid-id", "Malformed folder id");
  }
  if (!isValidCiphertext(encName)) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  const count = stmts.listFolders.all(req.user.id).length;
  if (count >= MAX_FOLDERS_PER_USER) {
    return bad(res, 403, "quota", "Folder limit reached");
  }
  const id = clientId ?? newId();
  const now = Date.now();
  try {
    stmts.createFolder.run(id, req.user.id, encName, now);
  } catch {
    return bad(res, 409, "exists", "A folder with that id already exists");
  }
  res.status(201).json({ id, createdAt: now });
});

app.put("/api/folders/:id", authMiddleware, (req, res) => {
  const { encName } = req.body ?? {};
  if (!isValidCiphertext(encName)) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (!stmts.folderById.get(req.params.id, req.user.id)) {
    return bad(res, 404, "not-found", "Folder not found");
  }
  stmts.renameFolder.run(encName, req.params.id, req.user.id);
  res.status(204).end();
});

app.delete("/api/folders/:id", authMiddleware, (req, res) => {
  stmts.deleteFolder.run(req.params.id, req.user.id);
  res.status(204).end();
});

app.get("/api/satchel", authMiddleware, (req, res) => {
  res.json({ items: stmts.listSatchel.all(req.user.id) });
});

app.post("/api/satchel", authMiddleware, (req, res) => {
  const { id, encData } = req.body ?? {};
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(id)) {
    return bad(res, 400, "invalid-id", "Malformed item id");
  }
  if (!isValidCiphertext(encData) || encData.length > MAX_SATCHEL_BYTES) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (stmts.countSatchel.get(req.user.id).n >= MAX_SATCHEL_PER_USER) {
    return bad(res, 403, "quota", "Satchel is full");
  }
  const now = Date.now();
  try {
    stmts.createSatchelItem.run(id, req.user.id, encData, now);
  } catch {
    return bad(res, 409, "exists", "That item already exists");
  }
  res.status(201).json({ id, createdAt: now });
});

app.delete("/api/satchel/:id", authMiddleware, (req, res) => {
  stmts.deleteSatchelItem.run(req.params.id, req.user.id);
  res.status(204).end();
});

app.get("/api/published", authMiddleware, (req, res) => {
  res.json({ items: stmts.listPublished.all(req.user.id) });
});

app.post("/api/published", authMiddleware, rateLimit(60, 10 * 60 * 1000), (req, res) => {
  const { encData, sceneId, encSecret, id: clientId } = req.body ?? {};
  if (clientId !== undefined && !CLIENT_ID_RE.test(String(clientId))) {
    return bad(res, 400, "invalid-id", "Malformed page id");
  }
  if (!isValidCiphertext(encData) || encData.length > MAX_SCENE_BYTES) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (encSecret != null && !isValidCiphertext(encSecret)) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (
    sceneId != null &&
    (typeof sceneId !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(sceneId))
  ) {
    return bad(res, 400, "invalid-id", "Malformed scene id");
  }
  const usage = stmts.countPublished.get(req.user.id);
  if (usage.n >= MAX_PUBLISHED_PER_USER) {
    return bad(res, 403, "quota", "Too many published pages");
  }
  if (usage.bytes + encData.length > MAX_PUBLISHED_BYTES_PER_USER) {
    return bad(res, 403, "quota", "Published pages are using too much space");
  }
  const id = clientId ?? newId();
  const now = Date.now();
  try {
    stmts.createPublished.run(
      id,
      req.user.id,
      sceneId ?? null,
      encData,
      encSecret ?? null,
      encData.length,
      now,
      now,
    );
  } catch {
    return bad(res, 409, "exists", "A page with that id already exists");
  }
  res.status(201).json({ id, createdAt: now, updatedAt: now });
});

app.put("/api/published/:id/secret", authMiddleware, (req, res) => {
  const { encSecret } = req.body ?? {};
  if (!isValidCiphertext(encSecret)) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (!stmts.publishedOwner.get(req.params.id, req.user.id)) {
    return bad(res, 404, "not-found", "No such published page");
  }
  stmts.setPublishedSecret.run(encSecret, req.params.id, req.user.id);
  res.status(204).end();
});

app.put("/api/published/:id", authMiddleware, (req, res) => {
  const { encData } = req.body ?? {};
  if (!isValidCiphertext(encData) || encData.length > MAX_SCENE_BYTES) {
    return bad(res, 400, "invalid-payload", "Malformed encrypted payload");
  }
  if (!stmts.publishedOwner.get(req.params.id, req.user.id)) {
    return bad(res, 404, "not-found", "No such published page");
  }
  const now = Date.now();
  stmts.updatePublished.run(
    encData,
    encData.length,
    now,
    req.params.id,
    req.user.id,
  );
  res.json({ id: req.params.id, updatedAt: now });
});

app.get(
  "/api/published/:id",
  rateLimit(240, 10 * 60 * 1000),
  (req, res) => {
    const row = stmts.publishedById.get(req.params.id);
    if (!row) return bad(res, 404, "not-found", "This page is not available");
    res.setHeader("Cache-Control", "no-store");
    res.json(row);
  },
);

app.delete("/api/published/:id", authMiddleware, (req, res) => {
  stmts.deletePublished.run(req.params.id, req.user.id);
  res.status(204).end();
});

const MAX_PASSKEYS_PER_USER = 20;

app.get("/api/passkeys/challenge", rateLimit(120, 10 * 60 * 1000), (req, res) => {
  const purpose = req.query.purpose === "register" ? "register" : "auth";
  res.json({ challenge: issueChallenge(purpose), rpId: expectedRpId(req) });
});

app.post("/api/passkeys/register", requireScope("keys"), async (req, res) => {
  const {
    credentialId,
    publicKey,
    alg,
    transports,
    clientDataJSON,
    authenticatorData,
    challenge,
    wrapped,
    label,
    assertion,
  } = req.body ?? {};

  if (!isValidCredentialId(credentialId)) {
    return bad(res, 400, "invalid-id", "Malformed credential id");
  }
  if (!isValidB64(publicKey) || (alg !== -7 && alg !== -257)) {
    return bad(res, 400, "invalid-payload", "Unsupported passkey key type");
  }
  if (!isWrapped(wrapped)) {
    return bad(res, 400, "invalid-payload", "Malformed key material");
  }
  if (!isValidB64(clientDataJSON) || !isValidB64(authenticatorData) || !isValidB64(challenge)) {
    return bad(res, 400, "invalid-payload", "Malformed registration");
  }
  if (stmts.countWrapsOfKind.get(req.user.id, "passkey").n >= MAX_PASSKEYS_PER_USER) {
    return bad(res, 403, "quota", "Too many passkeys on this account");
  }
  const existing = stmts.wrapByCredential.get(credentialId);
  if (existing) {
    return bad(res, 409, "exists", "That passkey is already registered");
  }

  const failure = verifyRegistration(req, {
    clientDataJSON,
    authenticatorData,
    challenge,
  });
  if (failure) return bad(res, 400, failure, "Could not verify that passkey");

  if (
    !assertion ||
    typeof assertion !== "object" ||
    !isValidB64(assertion.clientDataJSON) ||
    !isValidB64(assertion.authenticatorData) ||
    !isValidB64(assertion.signature) ||
    !isValidB64(assertion.challenge)
  ) {
    return bad(res, 400, "invalid-payload", "Missing proof of possession");
  }
  const proofFailure = await verifyAssertion(req, {
    clientDataJSON: assertion.clientDataJSON,
    authenticatorData: assertion.authenticatorData,
    signature: assertion.signature,
    challenge: assertion.challenge,
    publicKey,
    alg,
  });
  if (proofFailure) {
    return bad(res, 400, proofFailure, "That passkey could not prove it holds its key");
  }

  stmts.putWrap.run(
    req.user.id,
    "passkey",
    credentialId,
    wrapped,
    JSON.stringify({
      publicKey,
      alg,
      transports: Array.isArray(transports) ? transports.slice(0, 8) : [],
    }),
    typeof label === "string" ? label.slice(0, 64) : null,
    Date.now(),
  );
  const user = stmts.userById.get(req.user.id);
  res.status(201).json(keyStateFor(user));
});

app.post("/api/passkeys/login", rateLimit(30, 10 * 60 * 1000), async (req, res) => {
  const { credentialId, clientDataJSON, authenticatorData, signature, challenge } =
    req.body ?? {};
  const deny = () => bad(res, 401, "invalid-passkey", "That passkey was not accepted");

  if (!isValidCredentialId(credentialId)) return deny();
  if (
    !isValidB64(clientDataJSON) ||
    !isValidB64(authenticatorData) ||
    !isValidB64(signature) ||
    !isValidB64(challenge)
  ) {
    return deny();
  }
  const row = stmts.wrapByCredential.get(credentialId);
  if (!row) return deny();

  let params;
  try {
    params = JSON.parse(row.params);
  } catch {
    return deny();
  }
  const failure = await verifyAssertion(req, {
    clientDataJSON,
    authenticatorData,
    signature,
    challenge,
    publicKey: params.publicKey,
    alg: params.alg,
  });
  if (failure) return deny();

  const user = stmts.userById.get(row.userId);
  if (!user) return deny();
  res.json({
    token: issueToken(user.id, user.email, user.token_version),
    email: user.email,
    ...keyStateFor(user),
  });
});

app.delete("/api/passkeys/:credentialId", requireScope("keys"), (req, res) => {
  const { credentialId } = req.params;
  if (!isValidCredentialId(credentialId)) {
    return bad(res, 400, "invalid-id", "Malformed credential id");
  }
  const row = stmts.wrapByCredential.get(credentialId);
  if (!row || row.userId !== req.user.id) {
    return bad(res, 404, "not-found", "No such passkey");
  }
  const token = transaction(() => {
    stmts.deleteWrap.run(req.user.id, "passkey", credentialId);
    stmts.bumpTokenVersion.run(req.user.id);
    const fresh = stmts.userById.get(req.user.id);
    return issueToken(fresh.id, fresh.email, fresh.token_version);
  });
  const user = stmts.userById.get(req.user.id);
  res.json({ token, ...keyStateFor(user) });
});

registerRoomRoutes(app, { bad, rateLimit });

app.use("/api", (req, res) => bad(res, 404, "not-found", "Unknown endpoint"));

const clientDist = join(__dirname, "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (/\.(js|css|woff2?|svg|png)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.get("/{*splat}", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(clientDist, "index.html"));
  });
}

app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return bad(res, 413, "too-large", "Payload too large");
  }
  console.error(err);
  bad(res, 500, "internal", "Something went wrong");
});

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});

const server = app.listen(PORT, () => {
  console.log(`Lakar server listening on http://localhost:${PORT}`);
});

attachRoomSocket(server);
