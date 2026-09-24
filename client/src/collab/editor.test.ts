import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../../test/module-harness.mjs";
import { diffSince, mergeIncoming, mergeFullScene } from "./reconcile";

const element = (id = "a", version = 1, x = 0) => ({ id, version, versionNonce: version, x, y: 0, isDeleted: false });
function editor(elements = [element()]) {
  let state = { elements, selectedIds: new Set(["a"]), sceneNonce: 0, canvasBg: "white", sceneTitle: "Room", displayName: "Test" };
  state.replaceElements = elements => { state = { ...state, elements, sceneNonce: state.sceneNonce + 1 }; };
  state.setSelectedIds = ids => { state = { ...state, selectedIds: new Set(ids) }; };
  state.setEditingText = () => {};
  state.setCanvasBg = canvasBg => { state = { ...state, canvasBg }; };
  state.setSceneTitle = sceneTitle => { state = { ...state, sceneTitle }; };
  state.clearSelection = () => state.setSelectedIds([]);
  const useStore = { getState: () => state };
  let nonce = 100;
  const history = loadModule(new URL("../history.ts", import.meta.url), { useStore, newVersionNonce: () => nonce++ }, "history");
  const reorderSelected = loadModule(new URL("../interaction/actions.ts", import.meta.url), { useStore, history }, "reorderSelected");
  const collab = loadModule(new URL("./manager.ts", import.meta.url), {
    useStore, WebSocket: { OPEN: 1 }, diffSince, mergeIncoming, mergeFullScene,
    decryptString: async (_key, text) => text,
    invalidateShape() {}, clearShapeCache() {}, history, zoomToFit() {},
    window: { setTimeout: () => 1, clearTimeout() {} },
  }, "collab");
  collab.roomId = "room"; collab.socket = { readyState: 1 }; collab.keys = {}; collab.sceneReady = true;
  const messages = []; collab.sendWire = async payload => messages.push(structuredClone(payload));
  return { state: () => state, history, reorderSelected, collab, messages };
}

test("undo and redo emit newer versions which peers accept", () => {
  const h = editor(); h.history.reset();
  h.state().replaceElements([element("a", 2, 100)]); h.history.commit();
  let peer = structuredClone(h.state().elements);
  h.history.undo(); peer = mergeIncoming(peer, h.state().elements).elements;
  assert.equal(peer[0].x, 0); assert.ok(peer[0].version > 2);
  const undoVersion = peer[0].version;
  h.history.redo(); peer = mergeIncoming(peer, h.state().elements).elements;
  assert.equal(peer[0].x, 100); assert.ok(peer[0].version > undoVersion);
});

test("undoing creation sends a tombstone and redo revives it with a newer version", () => {
  const h = editor([]); h.history.reset(); h.state().replaceElements([element()]); h.history.commit();
  let peer = structuredClone(h.state().elements); h.history.undo();
  peer = mergeIncoming(peer, h.state().elements).elements;
  assert.equal(peer[0].isDeleted, true); assert.ok(peer[0].deletedAt);
  h.history.redo(); peer = mergeIncoming(peer, h.state().elements).elements;
  assert.equal(peer[0].isDeleted, false); assert.equal(peer[0].deletedAt, undefined);
});

test("undo preserves peer-only elements and fields changed by another participant", () => {
  const h = editor(); h.history.reset();
  h.state().replaceElements([element("a", 2, 100)]); h.history.commit();
  h.state().replaceElements([{ ...element("a", 3, 100), y: 50 }, element("peer")]);
  h.history.undo();
  assert.equal(h.state().elements.find(el => el.id === "a").x, 0);
  assert.equal(h.state().elements.find(el => el.id === "a").y, 50);
  assert.ok(h.state().elements.some(el => el.id === "peer"));
});

test("layer changes broadcast without geometry changes and converge on the peer", async () => {
  const a = editor([element("a"), element("b")]); const b = editor([element("a"), element("b")]);
  a.history.reset(); await a.collab.flushBroadcast();
  await b.collab.onWire("a", JSON.stringify(a.messages.at(-1)));
  a.reorderSelected("toFront"); await a.collab.flushBroadcast();
  const update = a.messages.at(-1);
  assert.equal(update.elements.length, 0); assert.ok(update.order);
  await b.collab.onWire("a", JSON.stringify(update));
  assert.deepEqual(Array.from(b.state().elements, el => el.id), ["b", "a"]);
  a.history.undo(); await a.collab.flushBroadcast();
  await b.collab.onWire("a", JSON.stringify(a.messages.at(-1)));
  assert.deepEqual(Array.from(b.state().elements, el => el.id), ["a", "b"]);
});

test("concurrent layer orders use the same winner on both peers", () => {
  const a = editor([element("a"), element("b"), element("c")]);
  const b = editor([element("a"), element("b"), element("c")]);
  const first = { text: JSON.stringify(["c", "b", "a"]), version: 4, nonce: 10 };
  const second = { text: JSON.stringify(["b", "a", "c"]), version: 4, nonce: 20 };
  a.collab.applyRemoteOrder(first); a.collab.applyRemoteOrder(second);
  b.collab.applyRemoteOrder(second); b.collab.applyRemoteOrder(first);
  assert.deepEqual(Array.from(a.state().elements, el => el.id), ["c", "b", "a"]);
  assert.deepEqual(Array.from(b.state().elements, el => el.id), ["c", "b", "a"]);
});
