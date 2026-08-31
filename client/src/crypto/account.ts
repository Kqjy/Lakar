import {
  arkCheckContext,
  dkCheckContext,
  generateArk,
  generateDataKey,
  keyringFor,
  makeCheck,
  unwrapArk,
  unwrapDataKey,
  verifyCheck,
  wrapArk,
  wrapDataKey,
  type Keyring,
} from "./e2ee";
import { recoveryKeysFromCode } from "./recovery";
import type { DataKeyRecord, KeyChange, KeyState } from "../sync/api";

export class AccountKeyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface UnlockedAccount {
  userId: string;
  ark: CryptoKey;
  ring: Keyring;
}

export const openArk = async (
  kek: CryptoKey,
  wrapped: string,
  userId: string,
  arkCheck: string | null,
  extractable = false,
): Promise<CryptoKey> => {
  let ark: CryptoKey;
  try {
    ark = await unwrapArk(kek, wrapped, extractable);
  } catch {
    throw new AccountKeyError("wrong-key", "That password is incorrect");
  }
  if (arkCheck && !(await verifyCheck(ark, arkCheck, arkCheckContext(userId)))) {
    throw new AccountKeyError(
      "check-failed",
      "Your key material looks corrupted — sign in again",
    );
  }
  return ark;
};

export const buildRing = async (
  ark: CryptoKey,
  dataKeys: DataKeyRecord[],
  writeEpoch: number,
  userId: string,
): Promise<Keyring> => {
  const entries: [number, CryptoKey][] = [];
  for (const record of dataKeys) {
    let key: CryptoKey;
    try {
      key = await unwrapDataKey(ark, record.wrapped, false);
    } catch {
      throw new AccountKeyError("bad-data-key", "A data key could not be unwrapped");
    }
    if (!(await verifyCheck(key, record.dkCheck, dkCheckContext(userId, record.epoch)))) {
      throw new AccountKeyError("check-failed", "A data key failed verification");
    }
    entries.push([record.epoch, key]);
  }
  if (!entries.some(([epoch]) => epoch === writeEpoch)) {
    throw new AccountKeyError(
      "no-write-key",
      "The key this account writes with is missing",
    );
  }
  return keyringFor(writeEpoch, entries);
};

export const openAccount = async (
  kek: CryptoKey,
  state: KeyState,
): Promise<UnlockedAccount> => {
  const wrap = state.wraps.find((w) => w.kind === "password");
  if (!wrap) throw new AccountKeyError("no-wrap", "This account has no password key");
  const ark = await openArk(kek, wrap.wrapped, state.userId, state.arkCheck);
  const ring = await buildRing(ark, state.dataKeys, state.writeEpoch, state.userId);
  return { userId: state.userId, ark, ring };
};

interface Provisioned {
  change: KeyChange;
  account: UnlockedAccount;
}

const finish = async (
  userId: string,
  kek: CryptoKey,
  ark: CryptoKey,
  dataKeys: { epoch: number; key: CryptoKey }[],
  writeEpoch: number,
  extra: Partial<KeyChange> = {},
): Promise<Provisioned> => {
  const wrappedArk = await wrapArk(kek, ark);
  const arkCheck = await makeCheck(ark, arkCheckContext(userId));
  const wrappedKeys = [];
  for (const { epoch, key } of dataKeys) {
    wrappedKeys.push({
      epoch,
      wrapped: await wrapDataKey(ark, key),
      dkCheck: await makeCheck(key, dkCheckContext(userId, epoch)),
    });
  }
  const change: KeyChange = {
    ...extra,
    arkCheck,
    writeEpoch,
    dataKeys: wrappedKeys,
    wraps: [
      ...(extra.wraps ?? []),
      { kind: "password", slot: "", wrapped: wrappedArk },
    ],
  };
  const reopened = await openArk(kek, wrappedArk, userId, arkCheck);
  const ring = await buildRing(
    reopened,
    wrappedKeys.map((k) => ({ ...k, createdAt: 0 })),
    writeEpoch,
    userId,
  );
  return { change, account: { userId, ark: reopened, ring } };
};

export const provisionNewAccount = async (
  userId: string,
  kek: CryptoKey,
  recoveryCode: string,
): Promise<Provisioned> => {
  const ark = await generateArk();
  const dk = await generateDataKey();
  const recovery = await recoveryKeysFromCode(recoveryCode);
  return finish(userId, kek, ark, [{ epoch: 0, key: dk }], 0, {
    recoveryAuthKey: recovery.authKey,
    wraps: [
      { kind: "recovery", slot: "", wrapped: await wrapArk(recovery.kek, ark) },
    ],
  });
};

export const provisionLegacyAccount = async (
  userId: string,
  kek: CryptoKey,
  legacyDataKey: CryptoKey,
  recoveryCode: string,
): Promise<Provisioned> => {
  const ark = await generateArk();
  const fresh = await generateDataKey();
  const recovery = await recoveryKeysFromCode(recoveryCode);
  return finish(
    userId,
    kek,
    ark,
    [
      { epoch: 0, key: legacyDataKey },
      { epoch: 1, key: fresh },
    ],
    1,
    {
      recoveryAuthKey: recovery.authKey,
      wraps: [
        { kind: "recovery", slot: "", wrapped: await wrapArk(recovery.kek, ark) },
      ],
    },
  );
};

export const rewrapForNewPassword = async (
  userId: string,
  currentKek: CryptoKey,
  nextKek: CryptoKey,
  nextAuthKey: string,
  state: KeyState,
): Promise<KeyChange> => {
  const wrap = state.wraps.find((w) => w.kind === "password");
  if (!wrap) throw new AccountKeyError("no-wrap", "This account has no password key");
  const ark = await openArk(currentKek, wrap.wrapped, userId, state.arkCheck, true);
  const wrapped = await wrapArk(nextKek, ark);
  await openArk(nextKek, wrapped, userId, state.arkCheck);
  return {
    newAuthKey: nextAuthKey,
    wraps: [{ kind: "password", slot: "", wrapped }],
  };
};

export const rewrapForNewRecoveryCode = async (
  userId: string,
  kek: CryptoKey,
  state: KeyState,
  recoveryCode: string,
): Promise<KeyChange> => {
  const wrap = state.wraps.find((w) => w.kind === "password");
  if (!wrap) throw new AccountKeyError("no-wrap", "This account has no password key");
  const ark = await openArk(kek, wrap.wrapped, userId, state.arkCheck, true);
  const recovery = await recoveryKeysFromCode(recoveryCode);
  const wrapped = await wrapArk(recovery.kek, ark);
  await openArk(recovery.kek, wrapped, userId, state.arkCheck);
  return {
    recoveryAuthKey: recovery.authKey,
    wraps: [{ kind: "recovery", slot: "", wrapped }],
  };
};

export const wrapArkForPasskey = async (
  userId: string,
  kek: CryptoKey,
  state: KeyState,
  passkeyKek: CryptoKey,
): Promise<string> => {
  const wrap = state.wraps.find((w) => w.kind === "password");
  if (!wrap) throw new AccountKeyError("no-wrap", "This account has no password key");
  const ark = await openArk(kek, wrap.wrapped, userId, state.arkCheck, true);
  const wrapped = await wrapArk(passkeyKek, ark);
  await openArk(passkeyKek, wrapped, userId, state.arkCheck);
  return wrapped;
};

export const openWithPasskey = async (
  passkeyKek: CryptoKey,
  credentialId: string,
  state: KeyState,
): Promise<UnlockedAccount> => {
  const wrap = state.wraps.find(
    (w) => w.kind === "passkey" && w.slot === credentialId,
  );
  if (!wrap) {
    throw new AccountKeyError(
      "no-wrap",
      "That passkey is not set up to unlock this account",
    );
  }
  const ark = await openArk(passkeyKek, wrap.wrapped, state.userId, state.arkCheck);
  const ring = await buildRing(ark, state.dataKeys, state.writeEpoch, state.userId);
  return { userId: state.userId, ark, ring };
};

export const rewrapFromRecovery = async (
  userId: string,
  recoveryKek: CryptoKey,
  recoveryWrapped: string,
  nextKek: CryptoKey,
  nextAuthKey: string,
  arkCheck: string | null,
): Promise<KeyChange> => {
  let ark: CryptoKey;
  try {
    ark = await unwrapArk(recoveryKek, recoveryWrapped, true);
  } catch {
    throw new AccountKeyError("wrong-key", "That recovery code is not valid");
  }
  if (arkCheck && !(await verifyCheck(ark, arkCheck, arkCheckContext(userId)))) {
    throw new AccountKeyError("check-failed", "Your key material looks corrupted");
  }
  const wrapped = await wrapArk(nextKek, ark);
  await openArk(nextKek, wrapped, userId, arkCheck);
  return {
    newAuthKey: nextAuthKey,
    wraps: [{ kind: "password", slot: "", wrapped }],
  };
};
