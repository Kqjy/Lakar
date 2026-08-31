import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, stmts } from "./db.js";

const SECRET_PATH = join(DATA_DIR, "secret.key");
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const loadSecret = () => {
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH);
  const secret = randomBytes(48);
  writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
};
const SECRET = process.env.TOKEN_SECRET
  ? Buffer.from(process.env.TOKEN_SECRET, "utf8")
  : loadSecret();

const b64url = (buf) =>
  Buffer.from(buf).toString("base64url");

const sign = (data) =>
  createHmac("sha256", SECRET).update(data).digest("base64url");

const SCOPED_TTL_MS = 1000 * 60 * 10;

export const issueToken = (
  userId,
  email,
  tokenVersion,
  scope = "session",
) => {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const ttl = scope === "session" ? TOKEN_TTL_MS : SCOPED_TTL_MS;
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      email,
      scope,
      tv: tokenVersion,
      iat: Date.now(),
      exp: Date.now() + ttl,
    }),
  );
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
};

export const verifyToken = (token) => {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = sign(`${parts[0]}.${parts[1]}`);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const hashAuthKey = (authKey, saltHex = null) => {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = scryptSync(authKey, salt, 32, SCRYPT_OPTS);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
};

export const verifyAuthKey = (authKey, saltHex, hashHex) => {
  const { hash } = hashAuthKey(authKey, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

const unauthorized = (res, message) =>
  res.status(401).json({ error: { code: "unauthorized", message } });

export const requireScope =
  (scope) =>
  (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) return unauthorized(res, "Sign in required");
    if ((payload.scope ?? "session") !== scope) {
      return unauthorized(res, "This action needs to be re-authorized");
    }
    const user = stmts.userById.get(payload.sub);
    if (!user) return unauthorized(res, "Account no longer exists");
    if (typeof payload.tv !== "number" || payload.tv !== user.token_version) {
      return unauthorized(res, "Your password changed — sign in again");
    }
    req.user = user;
    req.tokenScope = scope;
    next();
  };

export const authMiddleware = requireScope("session");

export const newId = () => randomUUID();

const buckets = new Map();

export const rateLimit = (max, windowMs) => (req, res, next) => {
  const key = `${req.path}:${req.ip}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (now - v.start > windowMs) buckets.delete(k);
    }
  }
  if (bucket.count > max) {
    return res.status(429).json({
      error: { code: "rate-limited", message: "Too many attempts — try again later" },
    });
  }
  next();
};
