import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../../test/module-harness.mjs";

const item = (id = "shape", name = "My shape") => ({ id, name, keywords: [], elements: [{ id: "el" }], createdAt: 1 });
const settle = () => new Promise(resolve => setImmediate(resolve));
async function setup(cache, remote = []) {
  let saved = structuredClone(cache);
  let signedIn = false;
  let state = { user: { email: "test@example.com" }, satchelItems: [], setSatchelItems(items) { state = { ...state, satchelItems: items }; } };
  const server = new Map(remote.map(it => [it.id, structuredClone(it)]));
  const calls = []; const timers = new Map();
  class ApiError extends Error { constructor(status) { super(); this.status = status; } }
  const api = {
    listSatchel: async () => ({ items: [...server.values()].map(it => ({ id: it.id, encData: JSON.stringify(it), createdAt: it.createdAt })) }),
    createSatchelItem: async (id, data) => { calls.push(["create", id]); if (server.has(id)) throw new ApiError(409); server.set(id, JSON.parse(data)); },
    updateSatchelItem: async (id, data) => { calls.push(["update", id]); if (!server.has(id)) throw new ApiError(404); server.set(id, JSON.parse(data)); },
    deleteSatchelItem: async id => { calls.push(["delete", id]); server.delete(id); },
  };
  const satchel = loadModule(new URL("./store.ts", import.meta.url), {
    api, ApiError, useStore: { getState: () => state },
    syncManager: { isSignedIn: () => signedIn, encryptForUser: async (_id, value) => JSON.stringify(value), decryptForUser: async (_id, value) => JSON.parse(value) },
    loadSatchelItems: async () => structuredClone(saved), saveSatchelItems: async value => { saved = structuredClone(value); },
    window: { setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); } },
  }, "satchel");
  await satchel.init(); signedIn = true;
  return { satchel, server, calls, timers, api, ApiError, state: () => state, cache: () => saved };
}
const cache = (items, writes = [], deletes = []) => ({ items, writes, deletes, owner: "test@example.com" });

test("a stale device accepts remote deletion instead of re-uploading its cache", async () => {
  const h = await setup(cache([item()]));
  await h.satchel.pullRemote();
  assert.equal(h.state().satchelItems.length, 0); assert.deepEqual(h.calls, []);
});

test("legacy account caches do not resurrect deleted items", async () => {
  const h = await setup([item()]); await h.satchel.pullRemote();
  assert.equal(h.state().satchelItems.length, 0); assert.deepEqual(h.calls, []);
});

test("offline removal remains hidden and its durable deletion retries after reload", async () => {
  const h = await setup(cache([item()]), [item()]);
  h.api.deleteSatchelItem = async () => { throw new h.ApiError(0); };
  await h.satchel.remove("shape"); await settle();
  assert.deepEqual(h.cache().deletes, ["shape"]); assert.equal(h.state().satchelItems.length, 0);
  assert.equal(h.timers.size, 1);
  const r = await setup(h.cache(), [item()]); await r.satchel.pullRemote();
  assert.equal(r.server.size, 0); assert.equal(r.state().satchelItems.length, 0);
  assert.deepEqual(r.cache().deletes, []);
});

test("pending creates retry and acknowledge a response lost after successful creation", async () => {
  const h = await setup(cache([item()], [["shape", "create"]]), [item()]);
  await h.satchel.pullRemote();
  assert.deepEqual(h.calls, [["create", "shape"], ["update", "shape"]]);
  assert.deepEqual(h.cache().writes, []); assert.equal(h.state().satchelItems.length, 1);
});

test("offline rename retries atomically without deleting the remote item", async () => {
  const h = await setup(cache([item()]), [item()]);
  h.api.updateSatchelItem = async () => { throw new h.ApiError(0); };
  await h.satchel.rename("shape", "Renamed"); await settle();
  assert.equal(h.server.get("shape").name, "My shape");
  assert.deepEqual(h.cache().writes, [["shape", "update"]]);
  const r = await setup(h.cache(), [item()]); await r.satchel.pullRemote();
  assert.equal(r.server.get("shape").name, "Renamed");
  assert.equal(r.calls.some(([method]) => method === "delete"), false);
});

test("a pending rename cannot recreate a shape deleted on another device", async () => {
  const h = await setup(cache([item("shape", "Renamed")], [["shape", "update"]]));
  await h.satchel.pullRemote();
  assert.equal(h.server.size, 0); assert.equal(h.state().satchelItems.length, 0);
  assert.deepEqual(h.cache().writes, []);
});
