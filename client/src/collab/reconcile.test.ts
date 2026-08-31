import test from "node:test";
import assert from "node:assert/strict";

import { mergeFullScene, mergeIncoming } from "./reconcile";
import { parseSceneFile, serializeScene } from "../export/json";
import { ROOM_RESUME_TTL, TOMBSTONE_TTL } from "../constants";
import type { LakarElement } from "../types";

const rect = (
  id: string,
  version: number,
  extra: Partial<LakarElement> = {},
): LakarElement =>
  ({
    id,
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#26241f",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundEdges: false,
    seed: 7,
    version,
    versionNonce: 1000 + version,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    link: null,
    locked: false,
    ...extra,
  }) as LakarElement;

test("room documents keep tombstones, plain documents drop them", () => {
  const elements = [
    rect("live", 3),
    rect("gone", 5, { isDeleted: true, deletedAt: Date.now() }),
  ];

  const plain = serializeScene(elements, "#fff", "Canvas");
  assert.equal(plain.elements.length, 1);
  assert.equal(plain.elements[0].id, "live");

  const room = serializeScene(elements, "#fff", "Canvas", true);
  assert.equal(room.elements.length, 2);
  const tomb = room.elements.find((el) => el.id === "gone")!;
  assert.equal(tomb.isDeleted, true);
  assert.equal(tomb.version, 5);
  assert.equal(tomb.versionNonce, 1005);
});

test("tombstones are stripped of geometry and payload", () => {
  const big = rect("gone", 2, {
    isDeleted: true,
    deletedAt: Date.now(),
    width: 900,
    height: 700,
    x: 400,
    y: 400,
  });
  const room = serializeScene([big], "#fff", undefined, true);
  const tomb = room.elements[0];
  assert.equal(tomb.width, 0);
  assert.equal(tomb.height, 0);
  assert.equal(tomb.x, 0);
  assert.equal(tomb.y, 0);
});

test("tombstones expire after the TTL", () => {
  const old = rect("ancient", 2, {
    isDeleted: true,
    deletedAt: Date.now() - TOMBSTONE_TTL - 1000,
  });
  const fresh = rect("recent", 2, { isDeleted: true, deletedAt: Date.now() });
  const room = serializeScene([old, fresh], "#fff", undefined, true);
  assert.deepEqual(
    room.elements.map((el) => el.id),
    ["recent"],
  );
});

test("parsing honours keepDeleted in both directions", () => {
  const doc = serializeScene(
    [rect("live", 1), rect("gone", 4, { isDeleted: true, deletedAt: Date.now() })],
    "#fff",
    "Canvas",
    true,
  );
  const raw = JSON.stringify(doc);

  const stripped = parseSceneFile(raw);
  assert.deepEqual(
    stripped.elements.map((el) => el.id),
    ["live"],
  );

  const kept = parseSceneFile(raw, true);
  assert.equal(kept.elements.length, 2);
  const tomb = kept.elements.find((el) => el.id === "gone")!;
  assert.equal(tomb.isDeleted, true);
  assert.equal(tomb.version, 4);
});

test("a rejoining peer does not resurrect what others deleted", () => {
  const retained = [rect("shared", 2), rect("mine-only", 1)];
  const room = serializeScene(
    [rect("shared", 3, { isDeleted: true, deletedAt: Date.now() })],
    "#fff",
    undefined,
    true,
  );
  const incoming = parseSceneFile(JSON.stringify(room), true).elements;

  const { elements } = mergeFullScene(retained, incoming);
  const shared = elements.find((el) => el.id === "shared")!;
  assert.equal(shared.isDeleted, true);
  const mine = elements.find((el) => el.id === "mine-only")!;
  assert.equal(mine.isDeleted, false);
});

test("a stale local edit loses to a newer remote version", () => {
  const local = [rect("shape", 2, { x: 999 })];
  const remote = [rect("shape", 5, { x: 5 })];
  const { elements, changed } = mergeIncoming(local, remote);
  assert.equal(elements[0].x, 5);
  assert.ok(changed.has("shape"));
});

test("without tombstones a full merge would resurrect the deletion", () => {
  const retained = [rect("shared", 2)];
  const legacy = serializeScene(
    [rect("shared", 3, { isDeleted: true, deletedAt: Date.now() })],
    "#fff",
  );
  const incoming = parseSceneFile(JSON.stringify(legacy)).elements;
  const { elements } = mergeFullScene(retained, incoming);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].isDeleted, false);
});

test("a retained copy can never outlive the tombstones that protect it", () => {
  assert.ok(
    ROOM_RESUME_TTL < TOMBSTONE_TTL,
    "a resume record must expire strictly before the tombstones it merges against",
  );
  assert.ok(
    TOMBSTONE_TTL - ROOM_RESUME_TTL >= 1000 * 60 * 60 * 24,
    "leave at least a day of slack for clock skew between peers",
  );

  const leftAt = Date.now() - ROOM_RESUME_TTL + 60_000;
  const deletedWhileAway = leftAt + 30_000;
  const retained = [rect("shape", 2)];
  const room = serializeScene(
    [rect("shape", 3, { isDeleted: true, deletedAt: deletedWhileAway })],
    "#fff",
    undefined,
    true,
  );
  assert.equal(room.elements.length, 1);

  const incoming = parseSceneFile(JSON.stringify(room), true).elements;
  const { elements } = mergeFullScene(retained, incoming);
  assert.equal(elements.find((el) => el.id === "shape")!.isDeleted, true);
});
