import { createHash, randomBytes, webcrypto } from "node:crypto";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 10_000;

const challenges = new Map();

export const issueChallenge = (purpose) => {
  const now = Date.now();
  for (const [k, v] of challenges) {
    if (v.expires < now) challenges.delete(k);
  }
  while (challenges.size >= MAX_CHALLENGES) {
    const oldest = challenges.keys().next();
    if (oldest.done) break;
    challenges.delete(oldest.value);
  }
  const challenge = randomBytes(32).toString("base64url");
  challenges.set(challenge, { purpose, expires: now + CHALLENGE_TTL_MS });
  return challenge;
};

const consumeChallenge = (challenge, purpose) => {
  const entry = challenges.get(challenge);
  if (!entry) return false;
  challenges.delete(challenge);
  return entry.purpose === purpose && entry.expires >= Date.now();
};

export const expectedOrigin = (req) => {
  if (process.env.LAKAR_ORIGIN) return process.env.LAKAR_ORIGIN;
  const host = req.get("host");
  const proto = req.protocol === "https" ? "https" : "http";
  return `${proto}://${host}`;
};

export const expectedRpId = (req) => {
  if (process.env.LAKAR_RP_ID) return process.env.LAKAR_RP_ID;
  const origin = expectedOrigin(req);
  try {
    return new URL(origin).hostname;
  } catch {
    return "localhost";
  }
};

const b64 = (s) => Buffer.from(s, "base64url");

const parseFlags = (authData) => {
  if (authData.length < 37) return null;
  const flags = authData[32];
  return {
    rpIdHash: authData.subarray(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: authData.readUInt32BE(33),
  };
};

const checkClientData = (clientDataB64, { type, challenge, origin }) => {
  let data;
  try {
    data = JSON.parse(b64(clientDataB64).toString("utf8"));
  } catch {
    return "malformed-client-data";
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "malformed-client-data";
  }
  if (data.type !== type) return "wrong-type";
  if (typeof data.challenge !== "string" || data.challenge !== challenge) {
    return "wrong-challenge";
  }
  if (data.origin !== origin) return "wrong-origin";
  return null;
};

const checkAuthenticatorData = (authData, rpId) => {
  const parsed = parseFlags(authData);
  if (!parsed) return "malformed-auth-data";
  const expected = createHash("sha256").update(rpId).digest();
  if (!parsed.rpIdHash.equals(expected)) return "wrong-rp";
  if (!parsed.userPresent) return "no-user-presence";
  if (!parsed.userVerified) return "no-user-verification";
  return null;
};

export const verifyRegistration = (req, { clientDataJSON, authenticatorData, challenge }) => {
  try {
    if (!consumeChallenge(challenge, "register")) return "bad-challenge";
    const clientError = checkClientData(clientDataJSON, {
      type: "webauthn.create",
      challenge,
      origin: expectedOrigin(req),
    });
    if (clientError) return clientError;
    return checkAuthenticatorData(b64(authenticatorData), expectedRpId(req));
  } catch {
    return "verification-failed";
  }
};

const ALGORITHMS = {
  "-7": {
    importParams: { name: "ECDSA", namedCurve: "P-256" },
    verifyParams: { name: "ECDSA", hash: "SHA-256" },
    derSignature: true,
  },
  "-257": {
    importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verifyParams: { name: "RSASSA-PKCS1-v1_5" },
    derSignature: false,
  },
};

const derToRaw = (der) => {
  if (der.length < 8 || der[0] !== 0x30) return null;
  if (der[1] & 0x80) return null;
  if (der[1] !== der.length - 2) return null;
  let offset = 2;
  const readInt = () => {
    if (offset + 2 > der.length || der[offset] !== 0x02) return null;
    const len = der[offset + 1];
    if (len < 1 || len > 33) return null;
    const start = offset + 2;
    const end = start + len;
    if (end > der.length) return null;
    if (der[start] & 0x80) return null;
    if (len > 1 && der[start] === 0x00 && !(der[start + 1] & 0x80)) return null;
    let value = der.subarray(start, end);
    if (value.length > 1 && value[0] === 0x00) value = value.subarray(1);
    if (value.length > 32) return null;
    offset = end;
    const padded = Buffer.alloc(32);
    value.copy(padded, 32 - value.length);
    return padded;
  };
  const r = readInt();
  if (!r) return null;
  const s = readInt();
  if (!s) return null;
  if (offset !== der.length) return null;
  return Buffer.concat([r, s]);
};

export const verifyAssertion = async (
  req,
  { clientDataJSON, authenticatorData, signature, challenge, publicKey, alg },
) => {
  try {
    if (!consumeChallenge(challenge, "auth")) return "bad-challenge";
    const clientError = checkClientData(clientDataJSON, {
      type: "webauthn.get",
      challenge,
      origin: expectedOrigin(req),
    });
    if (clientError) return clientError;

    const authData = b64(authenticatorData);
    const authError = checkAuthenticatorData(authData, expectedRpId(req));
    if (authError) return authError;

    const spec = ALGORITHMS[String(alg)];
    if (!spec) return "unsupported-algorithm";

    let key;
    try {
      key = await webcrypto.subtle.importKey(
        "spki",
        b64(publicKey),
        spec.importParams,
        false,
        ["verify"],
      );
    } catch {
      return "bad-public-key";
    }

    let sig = b64(signature);
    if (spec.derSignature) {
      sig = derToRaw(sig);
      if (!sig) return "bad-signature-format";
    }

    const clientHash = createHash("sha256").update(b64(clientDataJSON)).digest();
    const signed = Buffer.concat([authData, clientHash]);

    const ok = await webcrypto.subtle.verify(spec.verifyParams, key, sig, signed);
    return ok ? null : "bad-signature";
  } catch {
    return "verification-failed";
  }
};

export const isValidCredentialId = (id) =>
  typeof id === "string" && /^[A-Za-z0-9_-]{16,512}$/.test(id);

export const isValidB64 = (s, maxLen = 4096) =>
  typeof s === "string" && s.length <= maxLen && /^[A-Za-z0-9_-]+$/.test(s);
