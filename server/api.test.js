import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  arkCheckContext,
  decryptRecord,
  dkCheckContext,
  encryptRecord,
  generateArk,
  generateDataKey,
  keyringFor,
  makeCheck,
  unwrapDataKey,
  verifyCheck,
  wrapArk,
  wrapDataKey,
} from "../client/src/crypto/e2ee.ts";
import { openAccount } from "../client/src/crypto/account.ts";
import {
  generateRecoveryCode,
  recoveryKeysFromCode,
} from "../client/src/crypto/recovery.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}/api`;

let main;

const startServer = async (port, env = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "lakar-test-"));
  const proc = spawn(process.execPath, [join(__dirname, "index.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      LAKAR_INVITES: "",
      LAKAR_QUOTA_MB: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 15000);
    proc.stdout.on("data", (buf) => {
      if (buf.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
  return { proc, dir, base: `http://127.0.0.1:${port}/api` };
};

const stopServer = async (server) => {
  if (!server) return;
  if (server.proc.exitCode === null) {
    const exited = new Promise((resolve) => server.proc.once("exit", resolve));
    server.proc.kill();
    await exited;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(server.dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
};

const makeInvite = async (server, ...args) => {
  const proc = spawn(process.execPath, [join(__dirname, "invite.js"), ...args], {
    env: { ...process.env, DATA_DIR: server.dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (buf) => {
    out += buf.toString();
  });
  const exit = await new Promise((resolve) => proc.once("exit", resolve));
  assert.equal(exit, 0, out);
  return out.trim().split("\n")[0].trim();
};

before(async () => {
  main = await startServer(PORT);
});

after(() => stopServer(main));

const callTo = async (base, method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const call = (method, path, body, token) =>
  callTo(BASE, method, path, body, token);

const randomB64 = (n) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64url");

const aesKw = () =>
  crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, [
    "wrapKey",
    "unwrapKey",
  ]);

const provision = async (userId, kek, recoveryCode) => {
  const ark = await generateArk();
  const dk = await generateDataKey();
  const recovery = await recoveryKeysFromCode(recoveryCode);
  return {
    ark,
    dk,
    change: {
      arkCheck: await makeCheck(ark, arkCheckContext(userId)),
      writeEpoch: 0,
      dataKeys: [
        {
          epoch: 0,
          wrapped: await wrapDataKey(ark, dk),
          dkCheck: await makeCheck(dk, dkCheckContext(userId, 0)),
        },
      ],
      wraps: [
        { kind: "password", slot: "", wrapped: await wrapArk(kek, ark) },
        {
          kind: "recovery",
          slot: "",
          wrapped: await wrapArk(recovery.kek, ark),
        },
      ],
      recoveryAuthKey: recovery.authKey,
    },
  };
};

const newAccount = async (email) => {
  const userId = crypto.randomUUID();
  const kek = await aesKw();
  const authKey = randomB64(32);
  const recoveryCode = generateRecoveryCode();
  const { change, dk } = await provision(userId, kek, recoveryCode);
  const res = await call("POST", "/auth/register", {
    email,
    authKey,
    userId,
    ...change,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { userId, kek, authKey, recoveryCode, dk, ...res.body };
};

test("register returns a usable key state and login reproduces it", async () => {
  const acct = await newAccount("a@example.com");
  assert.equal(acct.userId, acct.body?.userId ?? acct.userId);
  assert.equal(acct.wraps.length, 2);
  assert.equal(acct.dataKeys.length, 1);
  assert.equal(acct.hasRecovery, true);

  const login = await call("POST", "/auth/login", {
    email: "a@example.com",
    authKey: acct.authKey,
  });
  assert.equal(login.status, 200);
  const opened = await openAccount(acct.kek, login.body);
  const ring = opened.ring;
  const blob = await encryptRecord(
    ring,
    { userId: acct.userId, type: "scene", id: "scene-1" },
    "hello",
  );
  assert.equal(
    await decryptRecord(ring, { userId: acct.userId, type: "scene", id: "scene-1" }, blob),
    "hello",
  );
});

test("only a reauthenticated, key-scoped token may touch key material", async () => {
  const acct = await newAccount("b@example.com");

  const denied = await call("POST", "/keys/rewrap", { writeEpoch: 0 }, acct.token);
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error.code, "unauthorized");

  const wrong = await call("POST", "/auth/reauth", { authKey: randomB64(32) }, acct.token);
  assert.equal(wrong.status, 401);

  const ok = await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token);
  assert.equal(ok.status, 200);
  assert.equal(
    (await call("POST", "/keys/rewrap", { writeEpoch: 0 }, ok.body.token)).status,
    200,
  );

  assert.equal((await call("GET", "/scenes", undefined, ok.body.token)).status, 401);

  const forged = await makeCheck(await generateArk(), arkCheckContext(acct.userId));
  const res = await call("POST", "/keys/rewrap", { arkCheck: forged }, ok.body.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.arkCheck, acct.arkCheck);
});

test("password change re-wraps the ARK and invalidates old sessions", async () => {
  const acct = await newAccount("e@example.com");
  const keysToken = (
    await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)
  ).body.token;

  const nextKek = await aesKw();
  const nextAuthKey = randomB64(32);
  const state = await call("GET", "/keys", undefined, acct.token);
  const opened = await openAccount(acct.kek, state.body);
  const newWrap = await wrapArk(nextKek, await crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(state.body.wraps.find((w) => w.kind === "password").wrapped, "base64url"),
    acct.kek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  ));

  const res = await call(
    "POST",
    "/keys/rewrap",
    {
      newAuthKey: nextAuthKey,
      wraps: [{ kind: "password", slot: "", wrapped: newWrap }],
    },
    keysToken,
  );
  assert.equal(res.status, 200);

  assert.equal((await call("GET", "/scenes", undefined, acct.token)).status, 401);
  assert.equal((await call("GET", "/scenes", undefined, res.body.token)).status, 200);

  assert.equal(
    (await call("POST", "/auth/login", { email: "e@example.com", authKey: acct.authKey }))
      .status,
    401,
  );
  const relogin = await call("POST", "/auth/login", {
    email: "e@example.com",
    authKey: nextAuthKey,
  });
  assert.equal(relogin.status, 200);

  const reopened = await openAccount(nextKek, relogin.body);
  assert.equal(reopened.ring.keys.size, opened.ring.keys.size);

  assert.equal(relogin.body.hasRecovery, true);
  assert.ok(relogin.body.wraps.some((w) => w.kind === "recovery"));
});

test("recovery denies bad codes uniformly and accepts the right one", async () => {
  const acct = await newAccount("f@example.com");

  const unknownEmail = await call("POST", "/auth/recover", {
    email: "nobody@example.com",
    recoveryAuthKey: randomB64(32),
  });
  const wrongCode = await call("POST", "/auth/recover", {
    email: "f@example.com",
    recoveryAuthKey: randomB64(32),
  });
  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongCode.status, 401);
  assert.deepEqual(unknownEmail.body, wrongCode.body);

  const recovery = await recoveryKeysFromCode(acct.recoveryCode);
  const started = await call("POST", "/auth/recover", {
    email: "f@example.com",
    recoveryAuthKey: recovery.authKey,
  });
  assert.equal(started.status, 200);
  assert.ok(started.body.wrapped);

  assert.equal((await call("GET", "/scenes", undefined, started.body.token)).status, 401);

  const ark = await crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(started.body.wrapped, "base64url"),
    recovery.kek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
  const nextKek = await aesKw();
  const nextAuthKey = randomB64(32);
  const done = await call(
    "POST",
    "/auth/recover/complete",
    {
      newAuthKey: nextAuthKey,
      wraps: [{ kind: "password", slot: "", wrapped: await wrapArk(nextKek, ark) }],
    },
    started.body.token,
  );
  assert.equal(done.status, 200);

  const login = await call("POST", "/auth/login", {
    email: "f@example.com",
    authKey: nextAuthKey,
  });
  assert.equal(login.status, 200);
  await openAccount(nextKek, login.body);
});

test("v2 ciphertext is accepted and client-supplied scene ids are honoured", async () => {
  const acct = await newAccount("g@example.com");
  const login = await call("POST", "/auth/login", {
    email: "g@example.com",
    authKey: acct.authKey,
  });
  const { ring } = await openAccount(acct.kek, login.body);
  const token = login.body.token;

  const id = crypto.randomUUID();
  const ctx = (type, recordId) => ({ userId: acct.userId, type, id: recordId });
  const created = await call(
    "POST",
    "/scenes",
    {
      id,
      encData: await encryptRecord(ring, ctx("scene", id), JSON.stringify({ a: 1 })),
      encTitle: await encryptRecord(ring, ctx("sceneTitle", id), "Test scene"),
      folderId: null,
    },
    token,
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.id, id);

  const dupe = await call(
    "POST",
    "/scenes",
    {
      id,
      encData: await encryptRecord(ring, ctx("scene", id), "{}"),
      encTitle: await encryptRecord(ring, ctx("sceneTitle", id), "x"),
      folderId: null,
    },
    token,
  );
  assert.equal(dupe.status, 409);

  const fetched = await call("GET", `/scenes/${id}`, undefined, token);
  assert.equal(fetched.status, 200);
  assert.equal(
    await decryptRecord(ring, ctx("scene", id), fetched.body.encData),
    JSON.stringify({ a: 1 }),
  );

  await assert.rejects(() =>
    decryptRecord(ring, ctx("scene", crypto.randomUUID()), fetched.body.encData),
  );
});

test("concurrent legacy migration cannot fork the hierarchy", async () => {
  const email = "legacy@example.com";
  const authKey = randomB64(32);
  const userId = crypto.randomUUID();
  const bare = await call("POST", "/auth/register", { email, authKey, userId });
  assert.equal(bare.status, 201);
  assert.equal(bare.body.wraps.length, 0);
  assert.equal(bare.body.arkCheck, null);

  const tokenA = (await call("POST", "/auth/reauth", { authKey }, bare.body.token))
    .body.token;
  const tokenB = (await call("POST", "/auth/reauth", { authKey }, bare.body.token))
    .body.token;
  const tabA = await provision(userId, await aesKw(), generateRecoveryCode());
  const tabB = await provision(userId, await aesKw(), generateRecoveryCode());

  const first = await call(
    "POST",
    "/keys/rewrap",
    { ...tabA.change, expectNoHierarchy: true },
    tokenA,
  );
  assert.equal(first.status, 200);

  const second = await call(
    "POST",
    "/keys/rewrap",
    { ...tabB.change, expectNoHierarchy: true },
    tokenB,
  );
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, "hierarchy-exists");

  const state = await call("GET", "/keys", undefined, bare.body.token);
  assert.equal(state.body.arkCheck, tabA.change.arkCheck);
  assert.equal(
    state.body.wraps.find((w) => w.kind === "password").wrapped,
    tabA.change.wraps.find((w) => w.kind === "password").wrapped,
  );
});

test("rewrap refuses states that would strand the account", async () => {
  const acct = await newAccount("i@example.com");
  const keysToken = (
    await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)
  ).body.token;

  const stranded = await call("POST", "/keys/rewrap", { writeEpoch: 9 }, keysToken);
  assert.equal(stranded.status, 400);
  assert.equal(stranded.body.error.code, "invalid-write-epoch");

  const unopenable = await call(
    "POST",
    "/keys/rewrap",
    { removeWraps: [{ kind: "password", slot: "" }] },
    keysToken,
  );
  assert.equal(unopenable.status, 400);
  assert.equal(unopenable.body.error.code, "no-password-wrap");

  const conflicting = await call(
    "POST",
    "/keys/rewrap",
    {
      dataKeys: [
        {
          epoch: 0,
          wrapped: await wrapDataKey(await generateArk(), await generateDataKey()),
          dkCheck: await makeCheck(await generateDataKey(), dkCheckContext(acct.userId, 0)),
        },
      ],
    },
    keysToken,
  );
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.body.error.code, "epoch-exists");

  const login = await call("POST", "/auth/login", {
    email: "i@example.com",
    authKey: acct.authKey,
  });
  await openAccount(acct.kek, login.body);
});

test("regenerating a recovery code retires tokens minted from the old one", async () => {
  const acct = await newAccount("j@example.com");
  const oldRecovery = await recoveryKeysFromCode(acct.recoveryCode);

  const started = await call("POST", "/auth/recover", {
    email: "j@example.com",
    recoveryAuthKey: oldRecovery.authKey,
  });
  assert.equal(started.status, 200);

  const keysToken = (
    await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)
  ).body.token;
  const newCode = generateRecoveryCode();
  const newRecovery = await recoveryKeysFromCode(newCode);
  const regen = await call(
    "POST",
    "/keys/rewrap",
    {
      recoveryAuthKey: newRecovery.authKey,
      wraps: [
        { kind: "recovery", slot: "", wrapped: randomB64(40).slice(0, 54).padEnd(54, "A") },
      ],
    },
    keysToken,
  );
  assert.equal(regen.status, 200);

  const stale = await call(
    "POST",
    "/auth/recover/complete",
    { newAuthKey: randomB64(32), wraps: [] },
    started.body.token,
  );
  assert.equal(stale.status, 401);

  const oldCodeAgain = await call("POST", "/auth/recover", {
    email: "j@example.com",
    recoveryAuthKey: oldRecovery.authKey,
  });
  assert.equal(oldCodeAgain.status, 401);
});

test("recovery is throttled per account, including unknown addresses", async () => {
  let sawRateLimit = false;
  for (let i = 0; i < 14; i++) {
    const res = await call("POST", "/auth/recover", {
      email: "never-registered@example.com",
      recoveryAuthKey: randomB64(32),
    });
    if (res.status === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.equal(sawRateLimit, true);
});

const sha256 = (buf) => createHash("sha256").update(buf).digest();

const rawToDer = (raw) => {
  const int = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.subarray(i);
    if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const body = Buffer.concat([int(raw.subarray(0, 32)), int(raw.subarray(32, 64))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
};

const makeAuthenticator = async (rpId) => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey));
  const credentialId = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));

  const authData = (flags = 0x05) =>
    Buffer.concat([sha256(rpId), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);

  const clientData = (type, challenge, origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin }), "utf8");

  return {
    credentialId: credentialId.toString("base64url"),
    publicKey: spki.toString("base64url"),
    alg: -7,
    register: (challenge, origin) => ({
      clientDataJSON: clientData("webauthn.create", challenge, origin).toString("base64url"),
      authenticatorData: authData().toString("base64url"),
    }),
    proof: async function (origin) {
      const challenge = (await call("GET", "/passkeys/challenge?purpose=auth")).body
        .challenge;
      return { challenge, ...(await this.assert(challenge, origin)) };
    },
    assert: async (challenge, origin, opts = {}) => {
      const cd = clientData(opts.type ?? "webauthn.get", challenge, origin);
      const ad = authData(opts.flags ?? 0x05);
      const signed = Buffer.concat([ad, sha256(cd)]);
      const raw = Buffer.from(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pair.privateKey,
          signed,
        ),
      );
      return {
        clientDataJSON: cd.toString("base64url"),
        authenticatorData: ad.toString("base64url"),
        signature: (opts.corruptSignature
          ? Buffer.concat([rawToDer(raw).subarray(0, -1), Buffer.from([0xff])])
          : rawToDer(raw)
        ).toString("base64url"),
      };
    },
  };
};

test("a passkey registers, signs in, and unlocks the same ARK", async () => {
  const acct = await newAccount("pk@example.com");
  const origin = `http://127.0.0.1:${PORT}`;
  const auth = await makeAuthenticator("127.0.0.1");
  const keysToken = (
    await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)
  ).body.token;

  const regChallenge = (await call("GET", "/passkeys/challenge?purpose=register")).body
    .challenge;
  const passkeyKek = await aesKw();
  const state = await call("GET", "/keys", undefined, acct.token);
  const ark = await crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(state.body.wraps.find((w) => w.kind === "password").wrapped, "base64url"),
    acct.kek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );

  const registered = await call(
    "POST",
    "/passkeys/register",
    {
      credentialId: auth.credentialId,
      publicKey: auth.publicKey,
      alg: auth.alg,
      transports: ["internal"],
      challenge: regChallenge,
      wrapped: await wrapArk(passkeyKek, ark),
      label: "Test key",
      assertion: await auth.proof(origin),
      ...auth.register(regChallenge, origin),
    },
    keysToken,
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  assert.ok(registered.body.wraps.some((w) => w.kind === "passkey"));

  const challenge = (await call("GET", "/passkeys/challenge?purpose=auth")).body.challenge;
  const login = await call("POST", "/passkeys/login", {
    credentialId: auth.credentialId,
    challenge,
    ...(await auth.assert(challenge, origin)),
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.email, "pk@example.com");

  const wrap = login.body.wraps.find((w) => w.kind === "passkey");
  const viaPasskey = await crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(wrap.wrapped, "base64url"),
    passkeyKek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
  const dk = await unwrapDataKey(viaPasskey, login.body.dataKeys[0].wrapped, false);
  assert.equal(
    await verifyCheck(dk, login.body.dataKeys[0].dkCheck, dkCheckContext(acct.userId, 0)),
    true,
  );
});

test("passkey assertions are rejected when anything about them is wrong", async () => {
  const origin = `http://127.0.0.1:${PORT}`;
  const auth = await makeAuthenticator("127.0.0.1");
  const acct = await newAccount("pk2@example.com");
  const keysToken = (
    await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)
  ).body.token;
  const regChallenge = (await call("GET", "/passkeys/challenge?purpose=register")).body
    .challenge;
  const state = await call("GET", "/keys", undefined, acct.token);
  await call(
    "POST",
    "/passkeys/register",
    {
      credentialId: auth.credentialId,
      publicKey: auth.publicKey,
      alg: auth.alg,
      transports: [],
      challenge: regChallenge,
      wrapped: state.body.wraps.find((w) => w.kind === "password").wrapped,
      label: "Test",
      assertion: await auth.proof(origin),
      ...auth.register(regChallenge, origin),
    },
    keysToken,
  );

  const fresh = async () =>
    (await call("GET", "/passkeys/challenge?purpose=auth")).body.challenge;

  const wrongOrigin = await fresh();
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: auth.credentialId,
        challenge: wrongOrigin,
        ...(await auth.assert(wrongOrigin, "https://evil.example")),
      })
    ).status,
    401,
  );

  const badSig = await fresh();
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: auth.credentialId,
        challenge: badSig,
        ...(await auth.assert(badSig, origin, { corruptSignature: true })),
      })
    ).status,
    401,
  );

  const noUv = await fresh();
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: auth.credentialId,
        challenge: noUv,
        ...(await auth.assert(noUv, origin, { flags: 0x01 })),
      })
    ).status,
    401,
  );

  const wrongRp = await makeAuthenticator("evil.example");
  const rpChallenge = await fresh();
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: auth.credentialId,
        challenge: rpChallenge,
        ...(await wrongRp.assert(rpChallenge, origin)),
      })
    ).status,
    401,
  );

  const replay = await fresh();
  const assertion = await auth.assert(replay, origin);
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: auth.credentialId,
        challenge: replay,
        ...assertion,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: auth.credentialId,
        challenge: replay,
        ...assertion,
      })
    ).status,
    401,
  );

  const unknown = await fresh();
  assert.equal(
    (
      await call("POST", "/passkeys/login", {
        credentialId: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
          "base64url",
        ),
        challenge: unknown,
        ...(await auth.assert(unknown, origin)),
      })
    ).status,
    401,
  );

  const other = await makeAuthenticator("127.0.0.1");
  const sessionOnly = (await call("GET", "/passkeys/challenge?purpose=register")).body
    .challenge;
  assert.equal(
    (
      await call(
        "POST",
        "/passkeys/register",
        {
          credentialId: other.credentialId,
          publicKey: other.publicKey,
          alg: other.alg,
          transports: [],
          challenge: sessionOnly,
          wrapped: state.body.wraps.find((w) => w.kind === "password").wrapped,
          label: "Nope",
          assertion: await other.proof(origin),
          ...other.register(sessionOnly, origin),
        },
        acct.token,
      )
    ).status,
    401,
  );

  const forged = await makeAuthenticator("127.0.0.1");
  const forgedChallenge = (await call("GET", "/passkeys/challenge?purpose=register")).body
    .challenge;
  const keysToken2 = (
    await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)
  ).body.token;
  assert.equal(
    (
      await call(
        "POST",
        "/passkeys/register",
        {
          credentialId: forged.credentialId,
          publicKey: forged.publicKey,
          alg: forged.alg,
          transports: [],
          challenge: forgedChallenge,
          wrapped: state.body.wraps.find((w) => w.kind === "password").wrapped,
          label: "No proof",
          assertion: await auth.proof(origin),
          ...forged.register(forgedChallenge, origin),
        },
        keysToken2,
      )
    ).status,
    400,
  );

  const passkeyViaRewrap = await call(
    "POST",
    "/keys/rewrap",
    {
      wraps: [
        {
          kind: "passkey",
          slot: "smuggled",
          wrapped: state.body.wraps.find((w) => w.kind === "password").wrapped,
        },
      ],
    },
    (await call("POST", "/auth/reauth", { authKey: acct.authKey }, acct.token)).body.token,
  );
  assert.equal(passkeyViaRewrap.status, 400);
});

test("malformed key material is rejected at registration", async () => {
  const res = await call("POST", "/auth/register", {
    email: "h@example.com",
    authKey: randomB64(32),
    userId: crypto.randomUUID(),
    wraps: [{ kind: "nonsense", slot: "", wrapped: "short" }],
  });
  assert.equal(res.status, 400);
});

const registerAt = async (server, email, extra = {}) => {
  const userId = crypto.randomUUID();
  const { change } = await provision(userId, await aesKw(), generateRecoveryCode());
  const res = await callTo(server.base, "POST", "/auth/register", {
    email,
    authKey: randomB64(32),
    userId,
    ...change,
    ...extra,
  });
  return { userId, ...res };
};

test("an open server advertises no invite gate", async () => {
  const meta = await call("GET", "/meta");
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body, { invitesRequired: false });
});

test("invite-only registration spends exactly one code per account", async () => {
  const server = await startServer(5198, { LAKAR_INVITES: "required" });
  try {
    const meta = await callTo(server.base, "GET", "/meta");
    assert.deepEqual(meta.body, { invitesRequired: true });

    const missing = await registerAt(server, "i1@example.com");
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error.code, "invite-required");

    const bogus = await registerAt(server, "i1@example.com", {
      inviteCode: "LKR-AAAA-BBBB-CCCC-DDDD",
    });
    assert.equal(bogus.status, 403);
    assert.equal(bogus.body.error.code, "invite-invalid");

    const code = await makeInvite(server);
    const created = await registerAt(server, "i1@example.com", { inviteCode: code });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const replay = await registerAt(server, "i2@example.com", { inviteCode: code });
    assert.equal(replay.status, 403);
    assert.equal(replay.body.error.code, "invite-invalid");

    const expired = await makeInvite(server, "--days", "-1");
    const stale = await registerAt(server, "i3@example.com", { inviteCode: expired });
    assert.equal(stale.status, 403);
    assert.equal(stale.body.error.code, "invite-invalid");

    const spare = await makeInvite(server);
    const taken = await registerAt(server, "i1@example.com", { inviteCode: spare });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, "email-taken");

    const rescued = await registerAt(server, "i4@example.com", { inviteCode: spare });
    assert.equal(rescued.status, 201, JSON.stringify(rescued.body));
  } finally {
    await stopServer(server);
  }
});

test("a storage quota blocks scene writes until space is freed", async () => {
  const server = await startServer(5197, { LAKAR_QUOTA_MB: "1" });
  const quota = 1024 * 1024;
  try {
    const meta = await callTo(server.base, "GET", "/meta");
    assert.deepEqual(meta.body, { invitesRequired: false });

    const acct = await registerAt(server, "quota@example.com");
    assert.equal(acct.status, 201, JSON.stringify(acct.body));
    const token = acct.body.token;
    const at = (method, path, body) =>
      callTo(server.base, method, path, body, token);

    const blob = (bytes) => `v2.0.${randomB64(12)}.${"A".repeat(bytes)}`;
    const scene = (id, bytes) => ({
      id,
      encData: blob(bytes),
      encTitle: blob(64),
      folderId: null,
    });

    const first = await at("POST", "/scenes", scene("quota-one", 600_000));
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await at("POST", "/scenes", scene("quota-two", 600_000));
    assert.equal(second.status, 413);
    assert.equal(second.body.error.code, "quota-exceeded");

    const listed = await at("GET", "/scenes");
    assert.equal(listed.body.quotaBytes, quota);
    assert.equal(listed.body.scenes.length, 1);
    assert.equal(listed.body.sceneBytes, listed.body.scenes[0].size);

    const grown = await at("PUT", "/scenes/quota-one", {
      encData: blob(1_100_000),
      version: 1,
    });
    assert.equal(grown.status, 413);
    assert.equal(grown.body.error.code, "quota-exceeded");

    const shrunk = await at("PUT", "/scenes/quota-one", {
      encData: blob(400_000),
      version: 1,
    });
    assert.equal(shrunk.status, 200);

    assert.equal((await at("DELETE", "/scenes/quota-one")).status, 204);
    const retried = await at("POST", "/scenes", scene("quota-two", 600_000));
    assert.equal(retried.status, 201, JSON.stringify(retried.body));
  } finally {
    await stopServer(server);
  }
});
