import { b64decode, b64encode } from "./e2ee";

const ROOM_PBKDF2_ITERATIONS = 320_000;
const enc = new TextEncoder();

export interface RoomKeys {
  key: CryptoKey;
  verifier: string;
}

const fromMaterial = async (material: BufferSource): Promise<RoomKeys> => {
  const hkdf = await crypto.subtle.importKey("raw", material, "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: enc.encode("lakar-room-enc-v1"),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const verifierBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: enc.encode("lakar-room-verify-v1"),
    },
    hkdf,
    256,
  );
  return { key, verifier: b64encode(verifierBits) };
};

export const newRoomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return b64encode(bytes);
};

export const newRoomSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64encode(bytes);
};

export const keysFromSecret = (secret: string): Promise<RoomKeys> =>
  fromMaterial(b64decode(secret) as BufferSource);

export const keysFromPassword = async (
  roomId: string,
  password: string,
): Promise<RoomKeys> => {
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const material = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: enc.encode(`lakar-room-v1:${roomId}`),
      iterations: ROOM_PBKDF2_ITERATIONS,
    },
    passKey,
    256,
  );
  return fromMaterial(material);
};

export interface RoomLinkParts {
  roomId: string;
  secret: string | null;
}

export const buildRoomLink = (roomId: string, secret: string | null): string => {
  const base = `${window.location.origin}${window.location.pathname}`;
  return secret ? `${base}#room=${roomId},${secret}` : `${base}#room=${roomId}`;
};

export const parseRoomHash = (hash: string): RoomLinkParts | null => {
  const match = /^room=([A-Za-z0-9_-]{16,32})(?:,([A-Za-z0-9_-]{40,50}))?$/.exec(
    hash.replace(/^#/, ""),
  );
  if (!match) return null;
  return { roomId: match[1], secret: match[2] ?? null };
};

export const clearRoomHash = () => {
  if (!window.location.hash) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
};

export const writeRoomHash = (roomId: string, secret: string | null) => {
  const hash = secret ? `#room=${roomId},${secret}` : `#room=${roomId}`;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
};
