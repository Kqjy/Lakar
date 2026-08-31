import { b64decode, b64encode } from "./e2ee";

const enc = new TextEncoder();

const prfSalt = async (): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode("lakar-prf-salt-v1")),
  );

export class PasskeyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const isPasskeySupported = (): boolean =>
  typeof PublicKeyCredential !== "undefined" &&
  typeof navigator.credentials?.create === "function";

export const hasPlatformAuthenticator = async (): Promise<boolean> => {
  if (!isPasskeySupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

export interface RegisteredPasskey {
  credentialId: string;
  publicKey: string;
  alg: number;
  transports: string[];
  clientDataJSON: string;
  authenticatorData: string;
}

const ES256 = -7;
const RS256 = -257;

export const createPasskey = async (
  challenge: string,
  userId: string,
  email: string,
  label: string,
): Promise<RegisteredPasskey> => {
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: b64decode(challenge) as BufferSource,
        rp: { name: "Lakar" },
        user: {
          id: enc.encode(userId) as BufferSource,
          name: email,
          displayName: label || email,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: ES256 },
          { type: "public-key", alg: RS256 },
        ],
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        attestation: "none",
        timeout: 120_000,
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new PasskeyError(
      (err as Error)?.name === "NotAllowedError" ? "cancelled" : "create-failed",
      (err as Error)?.name === "NotAllowedError"
        ? "Passkey setup was cancelled"
        : "This device could not create a passkey",
    );
  }
  if (!credential) throw new PasskeyError("create-failed", "No passkey was created");

  const ext = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };
  if (!ext.prf?.enabled) {
    throw new PasskeyError(
      "no-prf",
      "This authenticator can't hold an encryption key — it doesn't support the PRF extension",
    );
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  const alg = response.getPublicKeyAlgorithm?.();
  if (!spki || (alg !== ES256 && alg !== RS256)) {
    throw new PasskeyError(
      "unsupported-key",
      "This authenticator uses a key type Lakar can't verify",
    );
  }

  return {
    credentialId: credential.id,
    publicKey: b64encode(spki),
    alg,
    transports: response.getTransports?.() ?? [],
    clientDataJSON: b64encode(response.clientDataJSON),
    authenticatorData: b64encode(response.getAuthenticatorData?.() ?? new ArrayBuffer(0)),
  };
};

export interface PasskeyAssertion {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
  kek: CryptoKey;
}

export const assertPasskey = async (
  challenge: string,
  credentialId?: string,
): Promise<PasskeyAssertion> => {
  const salt = await prfSalt();
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: b64decode(challenge) as BufferSource,
        userVerification: "required",
        timeout: 120_000,
        ...(credentialId
          ? {
              allowCredentials: [
                {
                  type: "public-key" as const,
                  id: b64decode(credentialId) as BufferSource,
                },
              ],
            }
          : {}),
        extensions: {
          prf: { eval: { first: salt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new PasskeyError(
      (err as Error)?.name === "NotAllowedError" ? "cancelled" : "assert-failed",
      (err as Error)?.name === "NotAllowedError"
        ? "Passkey sign-in was cancelled"
        : "Could not use a passkey on this device",
    );
  }
  if (!credential) throw new PasskeyError("assert-failed", "No passkey was used");

  const ext = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfOutput = ext.prf?.results?.first;
  if (!prfOutput) {
    throw new PasskeyError(
      "no-prf",
      "That passkey can't unlock your scenes — it has no encryption secret",
    );
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: credential.id,
    clientDataJSON: b64encode(response.clientDataJSON),
    authenticatorData: b64encode(response.authenticatorData),
    signature: b64encode(response.signature),
    userHandle: response.userHandle
      ? new TextDecoder().decode(response.userHandle)
      : null,
    kek: await kekFromPrf(prfOutput),
  };
};

const kekFromPrf = async (prfOutput: ArrayBuffer): Promise<CryptoKey> => {
  const hkdf = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: enc.encode("lakar-passkey-v1"),
    },
    hkdf,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
};
