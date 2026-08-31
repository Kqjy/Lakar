import { b64decode, b64encode } from "./e2ee";

const enc = new TextEncoder();

export const newPublishSecret = (): string =>
  b64encode(crypto.getRandomValues(new Uint8Array(32)));

export const publishKeyFromSecret = async (
  secret: string,
): Promise<CryptoKey> => {
  const material = b64decode(secret);
  const hkdf = await crypto.subtle.importKey(
    "raw",
    material as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: enc.encode("lakar-publish-v1"),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

export const buildPublishLink = (id: string, secret: string): string =>
  `${window.location.origin}/p/${id}#k=${secret}`;

export interface PublishLinkParts {
  id: string;
  secret: string;
}

export const isPublishPath = (): boolean =>
  /^\/p\/([A-Za-z0-9_-]{6,40})\/?$/.test(window.location.pathname);

export const parsePublishLocation = (): PublishLinkParts | null => {
  const match = /^\/p\/([A-Za-z0-9_-]{6,40})\/?$/.exec(window.location.pathname);
  if (!match) return null;
  const key = /^k=([A-Za-z0-9_-]{40,50})$/.exec(
    window.location.hash.replace(/^#/, ""),
  );
  if (!key) return null;
  return { id: match[1], secret: key[1] };
};
