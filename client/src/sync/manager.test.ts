import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Execute the production manager with deterministic storage and network adapters.
// Removing imports keeps canvas, fonts and browser-only dependencies out of Node.
const source = readFileSync(new URL("./manager.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  transformers: { before: [() => (file) => ts.factory.updateSourceFile(
    file, file.statements.filter((statement) => !ts.isImportDeclaration(statement)),
  )] },
}).outputText.replace("export const syncManager", "const syncManager") + "\nglobalThis.manager = syncManager;";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const doc = (text) => ({ elements: [text], appState: { canvasBg: "white" } });
const meta = (id = "a", dirty = true) => ({
  id, title: id, folderId: null, remoteVersion: 1, dirty, createdAt: 1, updatedAt: 1,
});

function setup(saved = null) {
  let state = {
    user: { email: "test@example.com" }, scenes: [meta()], folders: [],
    sceneId: "a", sceneTitle: "a", sceneNonce: 0, elements: ["old"], canvasBg: "white",
  };
  const docs = new Map([["a", doc("old")], ["b", doc("b")]]);
  let cache = saved;
  const timers = new Map();
  const toasts = [];
  let timerId = 0;
  const api = {};
  class ApiError extends Error {
    constructor(status, code = "network") { super(code); this.status = status; this.code = code; }
  }
  for (const [method, key] of Object.entries({
    setScenes: "scenes", setFolders: "folders", setStorage: "storage", setSyncStatus: "status",
    setCanvasBg: "canvasBg", setSceneTitle: "sceneTitle",
  })) state[method] = (value) => { state = { ...state, [key]: value }; };
  state.replaceElements = (elements) => { state = { ...state, elements, sceneNonce: state.sceneNonce + 1 }; };
  state.setScene = (sceneId, sceneTitle) => { state = { ...state, sceneId, sceneTitle }; };
  state.clearSelection = () => {};
  state.toast = (message, type) => { toasts.push({ message, type }); };
  const context = createContext({
    api, ApiError, crypto, useStore: { getState: () => state },
    loadSceneDoc: async (id) => structuredClone(docs.get(id) ?? null),
    saveSceneDoc: async (id, value) => { docs.set(id, structuredClone(value)); },
    deleteSceneDoc: async (id) => { docs.delete(id); },
    loadRemoteCache: async () => structuredClone(cache),
    saveRemoteCache: async (value) => { cache = structuredClone(value); },
    saveGuestDoc: async () => {}, loadRoomResume: async () => null,
    encryptRecordJSON: async (_ring, _ctx, value) => JSON.stringify(value),
    encryptRecord: async (_ring, _ctx, value) => value,
    decryptRecordJSON: async (_ring, _ctx, value) => JSON.parse(value),
    decryptRecord: async (_ring, _ctx, value) => value,
    serializeScene: (elements, canvasBg) => ({ elements, appState: { canvasBg } }),
    parseSceneFile: (value) => {
      const parsed = JSON.parse(value);
      return { elements: parsed.elements, canvasBg: parsed.appState.canvasBg };
    },
    clearShapeCache: () => {}, history: { reset() {} }, zoomToFit() {}, DEFAULT_CANVAS_BG: "white",
    window: {
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  runInContext(code, context);
  const manager = context.manager;
  manager.userId = "user"; manager.ring = {}; manager.guestMode = false;
  return { manager, api, docs, timers, toasts, ApiError, state: () => state, cache: () => cache };
}

test("an edit saved during an upload is uploaded again with the acknowledged version", async () => {
  const h = setup(); const started = deferred(); const response = deferred(); const writes = [];
  h.api.updateScene = async (_id, body) => {
    writes.push(body);
    if (writes.length === 1) { started.resolve(); return response.promise; }
    return { version: 3 };
  };
  h.manager.pendingPush.add("a");
  const pushing = h.manager.pushPending(); await started.promise;
  h.state().replaceElements(["new"]); await h.manager.flushNow();
  response.resolve({ version: 2 }); await pushing;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].version, 2);
  assert.deepEqual(JSON.parse(writes[1].encData), doc("new"));
  assert.equal(h.state().scenes[0].dirty, false);
});

test("recreating a remotely deleted scene also retains edits made during the create", async () => {
  const h = setup(); const started = deferred(); const response = deferred(); const writes = [];
  h.api.updateScene = async (_id, body) => {
    writes.push(body);
    if (writes.length === 1) throw new h.ApiError(404);
    return { version: 2 };
  };
  h.api.createScene = async () => { started.resolve(); return response.promise; };
  h.manager.pendingPush.add("a"); const pushing = h.manager.pushPending(); await started.promise;
  h.state().replaceElements(["new"]); await h.manager.flushNow();
  response.resolve({ id: "a", version: 1 }); await pushing;
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[1].encData), doc("new"));
});

test("reload preserves the dirty base version and produces a conflict copy", async () => {
  const saved = { userId: "user", scenes: [{ ...meta(), version: 1 }], folders: [], lastOpenSceneId: "a" };
  const h = setup(saved); const copies = [];
  await h.manager.hydrateFromCache();
  h.api.listScenes = async () => ({ scenes: [{ id: "a", encTitle: "remote", version: 7 }], folders: [] });
  await h.manager.refreshRemote();
  assert.equal(h.state().scenes[0].remoteVersion, 1);
  assert.equal(h.state().scenes[0].title, "a");
  h.api.updateScene = async (_id, body) => { assert.equal(body.version, 1); throw new h.ApiError(409); };
  h.api.getScene = async () => ({ version: 7, encData: JSON.stringify(doc("other device")) });
  h.api.createScene = async (body) => { copies.push(body); return { id: body.id, version: 1 }; };
  await h.manager.pushPending();
  assert.equal(copies.length, 1);
  assert.deepEqual(JSON.parse(copies[0].encData), doc("old"));
  assert.deepEqual(h.docs.get("a"), doc("other device"));
});

test("a late download preserves edits before the autosave debounce fires", async () => {
  const h = setup(); h.state().setScene(null, ""); h.state().setScenes([meta("a", false)]);
  const started = deferred(); const response = deferred();
  h.api.getScene = async () => { started.resolve(); return response.promise; };
  const opening = h.manager.openScene("a"); await started.promise;
  h.state().replaceElements(["new"]);
  response.resolve({ version: 2, encData: JSON.stringify(doc("remote")) }); await opening;
  assert.deepEqual(h.state().elements, ["new"]);
});

test("an uncached scene adopts and saves edits made while its download is pending", async () => {
  const h = setup(); h.docs.delete("a"); h.state().setScene(null, "");
  h.state().setScenes([meta("a", false)]); h.state().replaceElements([]);
  const started = deferred(); const response = deferred(); const writes = [];
  h.api.getScene = async () => { started.resolve(); return response.promise; };
  h.api.updateScene = async (_id, body) => { writes.push(body); throw new h.ApiError(0); };
  const opening = h.manager.openScene("a"); await started.promise;
  h.state().replaceElements(["new"]);
  response.resolve({ version: 2, encData: JSON.stringify(doc("remote")) }); await opening;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state().sceneId, "a");
  assert.deepEqual(h.state().elements, ["new"]);
  assert.deepEqual(h.docs.get("a"), doc("new"));
  assert.equal(h.state().scenes[0].remoteVersion, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].version, 1);
});

test("a stale scene request cannot replace a more recently opened scene", async () => {
  const h = setup(); h.state().setScene(null, ""); h.state().setScenes([meta("a", false), meta("b", false)]);
  const started = deferred(); const response = deferred();
  h.api.getScene = async (id) => {
    if (id === "a") { started.resolve(); return response.promise; }
    return { version: 1, encData: JSON.stringify(doc("b")) };
  };
  const first = h.manager.openScene("a"); await started.promise;
  await h.manager.openScene("b");
  response.resolve({ version: 2, encData: JSON.stringify(doc("a remote")) }); await first;
  assert.equal(h.state().sceneId, "b");
  assert.equal(h.state().elements[0], "b");
});

test("offline deletion survives reload, stays hidden, and retries successfully", async () => {
  const h = setup(); h.state().setScenes([meta("a", false), meta("b", false)]);
  h.api.deleteScene = async () => { throw new h.ApiError(0); };
  await h.manager.deleteScene("b");
  assert.deepEqual(h.cache().pendingDeletes, ["b"]);
  assert.equal(h.docs.has("b"), false);
  assert.equal(h.timers.size, 1);
  const reloaded = setup(h.cache()); await reloaded.manager.hydrateFromCache();
  reloaded.api.listScenes = async () => ({ scenes: [{ id: "a", version: 1, encTitle: "a" }, { id: "b", version: 1, encTitle: "b" }], folders: [] });
  await reloaded.manager.refreshRemote();
  assert.equal(reloaded.state().scenes.some((scene) => scene.id === "b"), false);
  const deleted = deferred();
  reloaded.api.deleteScene = async (id) => { assert.equal(id, "b"); deleted.resolve(); };
  reloaded.manager.onOnline(); await deleted.promise;
  // Wait for the queue's storage promises to settle.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reloaded.cache().pendingDeletes, []);
});

test("deletion waits for an in-flight upload and cannot recreate the scene", async () => {
  const h = setup(); h.state().setScene("b", "b");
  const started = deferred(); const response = deferred(); const calls = [];
  h.api.updateScene = async () => { calls.push("put"); started.resolve(); return response.promise; };
  h.api.deleteScene = async () => { calls.push("delete"); };
  h.manager.pendingPush.add("a"); const pushing = h.manager.pushPending(); await started.promise;
  await h.manager.deleteScene("a"); response.resolve({ version: 2 }); await pushing;
  assert.deepEqual(calls, ["put", "delete"]);
  assert.equal(h.docs.has("a"), false);
  assert.equal(h.state().scenes.length, 0);
  assert.deepEqual(h.cache().pendingDeletes, []);
});

test("deleting another scene during an upload completes without a back online toast", async () => {
  const h = setup(); h.state().setScenes([meta(), meta("b", false)]);
  const started = deferred(); const response = deferred(); const deleted = [];
  h.api.updateScene = async () => { started.resolve(); return response.promise; };
  h.api.deleteScene = async (id) => { deleted.push(id); };
  h.manager.pendingPush.add("a"); const pushing = h.manager.pushPending(); await started.promise;
  await h.manager.deleteScene("b");
  response.resolve({ version: 2 }); await pushing;
  assert.equal(h.toasts.some(({ message }) => message.includes("back online")), false);
  assert.deepEqual(deleted, ["b"]);
  assert.equal(h.docs.has("b"), false);
  assert.equal(h.state().scenes.some((scene) => scene.id === "b"), false);
  assert.deepEqual(h.cache().pendingDeletes, []);
});

test("a clean scene still downloads and caches the latest remote document", async () => {
  const h = setup(); h.state().setScene(null, ""); h.state().setScenes([meta("a", false)]);
  h.api.getScene = async () => ({ version: 2, encData: JSON.stringify(doc("remote")) });
  await h.manager.openScene("a");
  assert.equal(h.state().elements[0], "remote");
  assert.deepEqual(h.docs.get("a"), doc("remote"));
  assert.equal(h.state().scenes[0].remoteVersion, 2);
});

test("edits during conflict-copy creation also reach a conflict copy", async () => {
  const h = setup(); const started = deferred(); const response = deferred(); const copies = [];
  h.api.updateScene = async () => { throw new h.ApiError(409); };
  h.api.getScene = async () => ({ version: 7, encData: JSON.stringify(doc("other device")) });
  h.api.createScene = async (body) => {
    copies.push(body);
    if (copies.length === 1) { started.resolve(); await response.promise; }
    return { id: body.id, version: 1 };
  };
  h.manager.pendingPush.add("a"); const pushing = h.manager.pushPending(); await started.promise;
  h.state().replaceElements(["new"]); await h.manager.flushNow();
  response.resolve(); await pushing;
  assert.equal(copies.length, 2);
  assert.deepEqual(JSON.parse(copies[1].encData), doc("new"));
  assert.equal(h.state().sceneId, copies[1].id);
  assert.deepEqual(h.docs.get("a"), doc("other device"));
});

test("a listing begun before a successful deletion cannot resurrect the scene", async () => {
  const h = setup(); h.state().setScenes([meta("a", false), meta("b", false)]);
  const started = deferred(); const response = deferred();
  h.api.listScenes = async () => { started.resolve(); return response.promise; };
  const refreshing = h.manager.refreshRemote(); await started.promise;
  h.api.deleteScene = async () => {};
  await h.manager.deleteScene("b");
  response.resolve({ scenes: [{ id: "a", version: 1, encTitle: "a" }, { id: "b", version: 1, encTitle: "b" }], folders: [] });
  await refreshing;
  assert.equal(h.state().scenes.some((scene) => scene.id === "b"), false);
});

test("deleting the active scene opens the remaining scene without re-saving the deleted one", async () => {
  const h = setup(); h.state().setScenes([meta("a", false), meta("b", false)]);
  h.api.deleteScene = async () => {};
  h.api.getScene = async () => ({ version: 1, encData: JSON.stringify(doc("b")) });
  await h.manager.deleteScene("a");
  assert.equal(h.state().sceneId, "b");
  assert.equal(h.docs.has("a"), false);
  assert.equal(h.manager.pendingPush.has("a"), false);
});
