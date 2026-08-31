const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64encode = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const b64decode = (s: string): Uint8Array => {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

export interface AccountKeys {
  authKey: string;
  kek: CryptoKey;
  deriveLegacyDataKey: () => Promise<CryptoKey>;
}

const hkdfParams = (info: string) => ({
  name: "HKDF" as const,
  hash: "SHA-256" as const,
  salt: new Uint8Array(32),
  info: enc.encode(info),
});

export const deriveKeys = async (
  email: string,
  password: string,
): Promise<AccountKeys> => {
  const salt = enc.encode(`lakar-kdf-v1:${email.trim().toLowerCase()}`);
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const masterBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    passKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    masterBits,
    "HKDF",
    false,
    ["deriveBits", "deriveKey"],
  );
  const authBits = await crypto.subtle.deriveBits(
    hkdfParams("lakar-auth-v1"),
    hkdfKey,
    256,
  );
  const kek = await crypto.subtle.deriveKey(
    hkdfParams("lakar-kek-v1"),
    hkdfKey,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
  return {
    authKey: b64encode(authBits),
    kek,
    deriveLegacyDataKey: async () => {
      const bits = await crypto.subtle.deriveBits(
        hkdfParams("lakar-enc-v1"),
        hkdfKey,
        256,
      );
      return crypto.subtle.importKey("raw", bits, "AES-GCM", true, [
        "encrypt",
        "decrypt",
      ]);
    },
  };
};

const ARK_USAGES: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];

export const generateArk = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ARK_USAGES);

export const wrapArk = async (kek: CryptoKey, ark: CryptoKey): Promise<string> =>
  b64encode(await crypto.subtle.wrapKey("raw", ark, kek, "AES-KW"));

export const unwrapArk = (
  kek: CryptoKey,
  wrapped: string,
  extractable: boolean,
): Promise<CryptoKey> =>
  crypto.subtle.unwrapKey(
    "raw",
    b64decode(wrapped) as BufferSource,
    kek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    extractable,
    ARK_USAGES,
  );

const DK_USAGES: KeyUsage[] = ["encrypt", "decrypt"];

export const generateDataKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, DK_USAGES);

export const wrapDataKey = async (
  ark: CryptoKey,
  dk: CryptoKey,
): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey("raw", dk, ark, {
    name: "AES-GCM",
    iv,
  });
  return `w1.${b64encode(iv)}.${b64encode(wrapped)}`;
};

export const unwrapDataKey = (
  ark: CryptoKey,
  wrapped: string,
  extractable: boolean,
): Promise<CryptoKey> => {
  const [prefix, ivB64, ctB64] = wrapped.split(".");
  if (prefix !== "w1" || !ivB64 || !ctB64) {
    throw new Error("Unrecognized wrapped key format");
  }
  return crypto.subtle.unwrapKey(
    "raw",
    b64decode(ctB64) as BufferSource,
    ark,
    { name: "AES-GCM", iv: b64decode(ivB64) as BufferSource },
    { name: "AES-GCM", length: 256 },
    extractable,
    DK_USAGES,
  );
};

const CHECK_PLAINTEXT = "lakar-check-v1";

export const makeCheck = async (
  key: CryptoKey,
  context: string,
): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(context) },
    key,
    enc.encode(CHECK_PLAINTEXT),
  );
  return `c1.${b64encode(iv)}.${b64encode(ct)}`;
};

export const verifyCheck = async (
  key: CryptoKey,
  blob: string,
  context: string,
): Promise<boolean> => {
  const [prefix, ivB64, ctB64] = (blob ?? "").split(".");
  if (prefix !== "c1" || !ivB64 || !ctB64) return false;
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: b64decode(ivB64) as BufferSource,
        additionalData: enc.encode(context),
      },
      key,
      b64decode(ctB64) as BufferSource,
    );
    return dec.decode(plain) === CHECK_PLAINTEXT;
  } catch {
    return false;
  }
};

export const arkCheckContext = (userId: string) => `ark|${userId}`;
export const dkCheckContext = (userId: string, epoch: number) =>
  `dk|${userId}|${epoch}`;

const COMPRESS_THRESHOLD = 512;

const compress = async (data: Uint8Array): Promise<Uint8Array | null> => {
  if (typeof CompressionStream === "undefined") return null;
  if (data.length < COMPRESS_THRESHOLD) return null;
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const MAX_INFLATED_BYTES = 96 * 1024 * 1024;

const decompress = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new Error("Compressed payload is implausibly large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export const encryptString = async (
  key: CryptoKey,
  plaintext: string,
): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let payload: Uint8Array<ArrayBufferLike> = enc.encode(plaintext);
  let prefix = "v1";
  const compressed = await compress(payload);
  if (compressed && compressed.length < payload.length) {
    payload = compressed;
    prefix = "v1z";
  }
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    payload as BufferSource,
  );
  return `${prefix}.${b64encode(iv)}.${b64encode(ct)}`;
};

export const decryptString = async (
  key: CryptoKey,
  transport: string,
): Promise<string> => {
  const [prefix, ivB64, ctB64] = transport.split(".");
  if ((prefix !== "v1" && prefix !== "v1z") || !ivB64 || !ctB64) {
    throw new Error("Unrecognized ciphertext format");
  }
  const iv = b64decode(ivB64);
  const ct = b64decode(ctB64);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(plain);
  if (prefix === "v1z") bytes = await decompress(bytes);
  return dec.decode(bytes);
};

export const encryptJSON = (key: CryptoKey, value: unknown) =>
  encryptString(key, JSON.stringify(value));

export const decryptJSON = async <T>(
  key: CryptoKey,
  transport: string,
): Promise<T> => JSON.parse(await decryptString(key, transport)) as T;

export type RecordType =
  | "scene"
  | "sceneTitle"
  | "folderName"
  | "satchel"
  | "publishSecret";

export interface RecordContext {
  userId: string;
  type: RecordType;
  id: string;
}

const recordAad = (
  prefix: string,
  epoch: number,
  ctx: RecordContext,
): Uint8Array =>
  enc.encode(`${prefix}|${epoch}|${ctx.userId}|${ctx.type}|${ctx.id}`);

export interface Keyring {
  writeEpoch: number;
  keys: Map<number, CryptoKey>;
}

export const keyringFor = (
  writeEpoch: number,
  entries: Iterable<[number, CryptoKey]>,
): Keyring => ({ writeEpoch, keys: new Map(entries) });

export const encryptRecord = async (
  ring: Keyring,
  ctx: RecordContext,
  plaintext: string,
): Promise<string> => {
  const epoch = ring.writeEpoch;
  const key = ring.keys.get(epoch);
  if (!key) throw new Error(`No data key for write epoch ${epoch}`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let payload: Uint8Array<ArrayBufferLike> = enc.encode(plaintext);
  let prefix = "v2";
  const compressed = await compress(payload);
  if (compressed && compressed.length < payload.length) {
    payload = compressed;
    prefix = "v2z";
  }
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: recordAad(prefix, epoch, ctx) as BufferSource,
    },
    key,
    payload as BufferSource,
  );
  return `${prefix}.${epoch}.${b64encode(iv)}.${b64encode(ct)}`;
};

export const decryptRecord = async (
  ring: Keyring,
  ctx: RecordContext,
  transport: string,
): Promise<string> => {
  const parts = transport.split(".");
  const prefix = parts[0];

  if (prefix === "v1" || prefix === "v1z") {
    const key = ring.keys.get(0);
    if (!key) throw new Error("No data key for legacy epoch 0");
    return decryptString(key, transport);
  }

  if ((prefix !== "v2" && prefix !== "v2z") || parts.length !== 4) {
    throw new Error("Unrecognized ciphertext format");
  }
  const epoch = Number(parts[1]);
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error("Malformed ciphertext epoch");
  }
  const key = ring.keys.get(epoch);
  if (!key) throw new Error(`No data key for epoch ${epoch}`);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64decode(parts[2]) as BufferSource,
      additionalData: recordAad(prefix, epoch, ctx) as BufferSource,
    },
    key,
    b64decode(parts[3]) as BufferSource,
  );
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(plain);
  if (prefix === "v2z") bytes = await decompress(bytes);
  return dec.decode(bytes);
};

export const encryptRecordJSON = (
  ring: Keyring,
  ctx: RecordContext,
  value: unknown,
) => encryptRecord(ring, ctx, JSON.stringify(value));

export const decryptRecordJSON = async <T>(
  ring: Keyring,
  ctx: RecordContext,
  transport: string,
): Promise<T> => JSON.parse(await decryptRecord(ring, ctx, transport)) as T;
