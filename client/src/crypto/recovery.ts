import { b64encode } from "./e2ee";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; 
const CODE_BYTES = 15; 
const CODE_CHARS = 24;
const GROUP = 4;

const enc = new TextEncoder();

export const formatRecoveryCode = (raw: string): string =>
  raw.match(new RegExp(`.{1,${GROUP}}`, "g"))?.join("-") ?? raw;

export const generateRecoveryCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_BYTES));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return formatRecoveryCode(out);
};

export const normalizeRecoveryCode = (input: string): string =>
  input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");

export const isValidRecoveryCode = (input: string): boolean => {
  const norm = normalizeRecoveryCode(input);
  if (norm.length !== CODE_CHARS) return false;
  return [...norm].every((ch) => ALPHABET.includes(ch));
};

const decodeRecoveryCode = (input: string): Uint8Array => {
  const norm = normalizeRecoveryCode(input);
  if (!isValidRecoveryCode(norm)) throw new Error("Malformed recovery code");
  const out = new Uint8Array(CODE_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const ch of norm) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
};

export interface RecoveryKeys {
  kek: CryptoKey;
  authKey: string;
}

const hkdfParams = (info: string) => ({
  name: "HKDF" as const,
  hash: "SHA-256" as const,
  salt: new Uint8Array(32),
  info: enc.encode(info),
});

export const recoveryKeysFromCode = async (
  code: string,
): Promise<RecoveryKeys> => {
  const material = decodeRecoveryCode(code);
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    material as BufferSource,
    "HKDF",
    false,
    ["deriveBits", "deriveKey"],
  );
  const kek = await crypto.subtle.deriveKey(
    hkdfParams("lakar-recovery-v1"),
    hkdfKey,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
  const authBits = await crypto.subtle.deriveBits(
    hkdfParams("lakar-recovery-auth-v1"),
    hkdfKey,
    256,
  );
  return { kek, authKey: b64encode(authBits) };
};
