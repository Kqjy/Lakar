import test from "node:test";
import assert from "node:assert/strict";

import {
  arkCheckContext,
  b64decode,
  b64encode,
  decryptRecord,
  decryptString,
  dkCheckContext,
  encryptRecord,
  encryptString,
  generateArk,
  generateDataKey,
  keyringFor,
  makeCheck,
  unwrapArk,
  unwrapDataKey,
  verifyCheck,
  wrapArk,
  wrapDataKey,
  type RecordContext,
} from "./e2ee.ts";
import {
  generateRecoveryCode,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  recoveryKeysFromCode,
} from "./recovery.ts";

const USER = "11111111-2222-3333-4444-555555555555";
const ctx = (id: string): RecordContext => ({
  userId: USER,
  type: "scene",
  id,
});

const aesKw = async () =>
  crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, [
    "wrapKey",
    "unwrapKey",
  ]);

test("base64url round trips and stays url-safe", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(97));
  const encoded = b64encode(bytes);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual([...b64decode(encoded)], [...bytes]);
});

test("v2 records round trip, including the compressed variant", async () => {
  const dk = await generateDataKey();
  const ring = keyringFor(0, [[0, dk]]);
  for (const text of ["hi", "x".repeat(4000)]) {
    const blob = await encryptRecord(ring, ctx("scene-a"), text);
    assert.match(blob, /^v2z?\.0\./);
    assert.equal(await decryptRecord(ring, ctx("scene-a"), blob), text);
  }
});

test("record ciphertext is bound to its own slot", async () => {
  const dk = await generateDataKey();
  const ring = keyringFor(0, [[0, dk]]);
  const blob = await encryptRecord(ring, ctx("scene-a"), "secret");

  await assert.rejects(() => decryptRecord(ring, ctx("scene-b"), blob));
  await assert.rejects(() =>
    decryptRecord(ring, { userId: USER, type: "sceneTitle", id: "scene-a" }, blob),
  );
  await assert.rejects(() =>
    decryptRecord(ring, { userId: "someone-else", type: "scene", id: "scene-a" }, blob),
  );
});

test("a tampered epoch tag fails authentication rather than decrypting", async () => {
  const dk = await generateDataKey();
  const ring = keyringFor(1, [
    [0, await generateDataKey()],
    [1, dk],
  ]);
  const blob = await encryptRecord(ring, ctx("scene-a"), "secret");
  const relabelled = blob.replace(/^v2(z?)\.1\./, "v2$1.0.");
  await assert.rejects(() => decryptRecord(ring, ctx("scene-a"), relabelled));
});

test("legacy v1 ciphertext still reads through the v2 path", async () => {
  const legacy = await generateDataKey();
  const written = await encryptString(legacy, "from the old build");
  assert.match(written, /^v1z?\./);

  const ring = keyringFor(1, [
    [0, legacy],
    [1, await generateDataKey()],
  ]);
  assert.equal(
    await decryptRecord(ring, ctx("old-scene"), written),
    "from the old build",
  );

  const fresh = await encryptRecord(ring, ctx("new-scene"), "written today");
  assert.match(fresh, /^v2z?\.1\./);
  assert.equal(await decryptRecord(ring, ctx("new-scene"), fresh), "written today");
});

test("decrypting at an unknown epoch fails loudly", async () => {
  const ring = keyringFor(0, [[0, await generateDataKey()]]);
  const blob = await encryptRecord(ring, ctx("s"), "x");
  const stranded = blob.replace(/^v2(z?)\.0\./, "v2$1.7.");
  await assert.rejects(
    () => decryptRecord(ring, ctx("s"), stranded),
    /No data key for epoch 7/,
  );
});

test("the ARK wraps and unwraps, and a wrong KEK is rejected", async () => {
  const kek = await aesKw();
  const wrong = await aesKw();
  const ark = await generateArk();
  const wrapped = await wrapArk(kek, ark);

  const reopened = await unwrapArk(kek, wrapped, false);
  assert.equal(reopened.extractable, false);
  await assert.rejects(() => unwrapArk(wrong, wrapped, false));
});

test("data keys wrap under the ARK and survive the round trip", async () => {
  const ark = await generateArk();
  const dk = await generateDataKey();
  const wrapped = await wrapDataKey(ark, dk);
  const reopened = await unwrapDataKey(ark, wrapped, false);
  assert.equal(reopened.extractable, false);

  const ring = keyringFor(0, [[0, dk]]);
  const reopenedRing = keyringFor(0, [[0, reopened]]);
  const blob = await encryptRecord(ring, ctx("s"), "same key");
  assert.equal(await decryptRecord(reopenedRing, ctx("s"), blob), "same key");
});

test("check blobs accept the right key and reject everything else", async () => {
  const ark = await generateArk();
  const other = await generateArk();
  const blob = await makeCheck(ark, arkCheckContext(USER));

  assert.equal(await verifyCheck(ark, blob, arkCheckContext(USER)), true);
  assert.equal(await verifyCheck(other, blob, arkCheckContext(USER)), false);
  assert.equal(await verifyCheck(ark, blob, arkCheckContext("someone-else")), false);
  assert.equal(await verifyCheck(ark, "c1.aaaa.bbbb", arkCheckContext(USER)), false);
  assert.equal(await verifyCheck(ark, "", arkCheckContext(USER)), false);
});

test("data key check blobs are bound to their epoch", async () => {
  const dk = await generateDataKey();
  const blob = await makeCheck(dk, dkCheckContext(USER, 1));
  assert.equal(await verifyCheck(dk, blob, dkCheckContext(USER, 1)), true);
  assert.equal(await verifyCheck(dk, blob, dkCheckContext(USER, 0)), false);
});

test("a password change re-wraps the ARK without touching data", async () => {
  const oldKek = await aesKw();
  const newKek = await aesKw();
  const recoveryKek = await aesKw();

  const ark = await generateArk();
  const dk = await generateDataKey();
  const wrappedDk = await wrapDataKey(ark, dk);
  const underOld = await wrapArk(oldKek, ark);
  const underRecovery = await wrapArk(recoveryKek, ark);

  const ring = keyringFor(0, [[0, dk]]);
  const blob = await encryptRecord(ring, ctx("s"), "unchanged by the rewrap");

  const opened = await unwrapArk(oldKek, underOld, true);
  const underNew = await wrapArk(newKek, opened);

  const viaNew = await unwrapArk(newKek, underNew, false);
  const dkViaNew = await unwrapDataKey(viaNew, wrappedDk, false);
  assert.equal(
    await decryptRecord(keyringFor(0, [[0, dkViaNew]]), ctx("s"), blob),
    "unchanged by the rewrap",
  );

  const viaRecovery = await unwrapArk(recoveryKek, underRecovery, false);
  const dkViaRecovery = await unwrapDataKey(viaRecovery, wrappedDk, false);
  assert.equal(
    await decryptRecord(keyringFor(0, [[0, dkViaRecovery]]), ctx("s"), blob),
    "unchanged by the rewrap",
  );
});

test("recovery codes are 120 bits in six groups of four", () => {
  const code = generateRecoveryCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  assert.equal(normalizeRecoveryCode(code).length, 24);
  assert.equal(isValidRecoveryCode(code), true);
});

test("recovery code entry tolerates the mistakes people actually make", () => {
  const code = generateRecoveryCode();
  const messy = code.toLowerCase().replace(/-/g, " ");
  assert.equal(isValidRecoveryCode(messy), true);
  assert.equal(normalizeRecoveryCode(messy), normalizeRecoveryCode(code));
  assert.equal(normalizeRecoveryCode("OIL0"), "0110");
  assert.equal(isValidRecoveryCode("too-short"), false);
});

test("a recovery code opens the ARK, and a different code does not", async () => {
  const code = generateRecoveryCode();
  const ark = await generateArk();
  const { kek, authKey } = await recoveryKeysFromCode(code);
  const wrapped = await wrapArk(kek, ark);

  const again = await recoveryKeysFromCode(code.toLowerCase().replace(/-/g, ""));
  assert.equal(again.authKey, authKey);
  await assert.doesNotReject(() => unwrapArk(again.kek, wrapped, false));

  const other = await recoveryKeysFromCode(generateRecoveryCode());
  assert.notEqual(other.authKey, authKey);
  await assert.rejects(() => unwrapArk(other.kek, wrapped, false));
});

test("the recovery auth key never reveals the unwrapping key", async () => {
  const code = generateRecoveryCode();
  const { kek, authKey } = await recoveryKeysFromCode(code);
  const ark = await generateArk();
  const wrapped = await wrapArk(kek, ark);

  const asKek = await crypto.subtle.importKey(
    "raw",
    b64decode(authKey) as BufferSource,
    "AES-KW",
    false,
    ["wrapKey", "unwrapKey"],
  );
  await assert.rejects(() => unwrapArk(asKek, wrapped, false));
  assert.match(authKey, /^[A-Za-z0-9_-]{40,50}$/);
});

test("compression kicks in only above the threshold", async () => {
  const dk = await generateDataKey();
  const ring = keyringFor(0, [[0, dk]]);

  const small = "a".repeat(400);
  const smallBlob = await encryptRecord(ring, ctx("s"), small);
  assert.match(smallBlob, /^v2\./);
  assert.equal(await decryptRecord(ring, ctx("s"), smallBlob), small);

  const big = "a".repeat(4000);
  const bigBlob = await encryptRecord(ring, ctx("s"), big);
  assert.match(bigBlob, /^v2z\./);
  assert.ok(bigBlob.length < big.length);
  assert.equal(await decryptRecord(ring, ctx("s"), bigBlob), big);
});

test("v1 helpers still work for rooms and published pages", async () => {
  const key = await generateDataKey();
  const text = "room wire payload";
  assert.equal(await decryptString(key, await encryptString(key, text)), text);
  await assert.rejects(() => decryptString(key, "v9.aaaa.bbbb"));
});
