import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "./elements";
import { DEFAULT_ITEM } from "./constants";
import { expandWithBoundTexts, getContainerOf, syncBoundText } from "./boundText";
import { getElementAtPosition } from "./hitTest";
import { updateBoundArrows } from "./binding";
import { parseSceneFile, serializeScene } from "./export/json";

// Deterministic canvas metrics; exercise the real wrapping and layout code.
globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 10 }) }) }),
};

function fixture(type = "rectangle") {
  const shape = createElement({ type, x: 100, y: 100, defaults: DEFAULT_ITEM });
  Object.assign(shape, { width: 200, height: 200 });
  const text = createElement({ type: "text", x: 0, y: 0, defaults: DEFAULT_ITEM });
  Object.assign(text, { text: "Hello", originalText: "Hello", containerId: shape.id, textAlign: "center" });
  return { shape, text, elements: [shape, text] };
}

test("all shape types support top, middle, bottom and legacy centering", () => {
  for (const type of ["rectangle", "ellipse", "diamond"]) {
    const { shape, text, elements } = fixture(type);
    for (const [alignment, expectedY] of [["top", 110], ["middle", 187.5], ["bottom", 265], [undefined, 187.5]]) {
      text.verticalAlign = alignment;
      syncBoundText(elements, shape);
      assert.equal(text.y, expectedY);
      assert.equal(text.x, 175);
    }
  }
});

test("bottom alignment follows resizing and multiline wrapping", () => {
  const { shape, text, elements } = fixture();
  text.verticalAlign = "bottom";
  text.originalText = "Hello world Hello world";
  shape.width = 100;
  syncBoundText(elements, shape);
  assert.equal(text.text.split("\n").length, 4);
  assert.equal(text.y + text.height, 290);
  shape.height = 300;
  syncBoundText(elements, shape);
  assert.equal(text.y + text.height, 390);
});

test("aligned text rotates with its shape", () => {
  const { shape, text, elements } = fixture();
  text.verticalAlign = "top";
  shape.angle = Math.PI / 2;
  syncBoundText(elements, shape);
  assert.equal(text.angle, shape.angle);
  assert.ok(Math.abs(text.x + text.width / 2 - 277.5) < 1e-9);
  assert.ok(Math.abs(text.y + text.height / 2 - 200) < 1e-9);
});

test("saved alignment survives reload and invalid or absent values default to middle", () => {
  const { text, elements } = fixture();
  for (const alignment of ["top", "middle", "bottom", undefined, "invalid"]) {
    text.verticalAlign = alignment;
    const doc = serializeScene(elements, "#ffffff");
    const restored = parseSceneFile(JSON.stringify(doc)).elements.find((el) => el.type === "text");
    assert.equal(restored.verticalAlign, ["top", "bottom"].includes(alignment) ? alignment : "middle");
  }
});

test("arrow labels follow the path midpoint without resizing the arrow", () => {
  const { shape: arrow, text, elements } = fixture("arrow");
  arrow.points = [[0, 0], [100, 0], [100, 300]];
  arrow.width = 100;
  arrow.height = 300;
  syncBoundText(elements, arrow);
  assert.equal(text.x + text.width / 2, 200);
  assert.equal(text.y + text.height / 2, 200);
  assert.equal(text.angle, 0);
  arrow.points = [[0, 0], [0, 200]];
  text.originalText = "A long label that should not resize the arrow";
  updateBoundArrows(elements, new Set([arrow.id]));
  assert.equal(text.x + text.width / 2, 100);
  assert.equal(text.y + text.height / 2, 200);
  assert.equal(arrow.width, 100);
  assert.equal(arrow.height, 300);
});

test("arrow label hit testing selects its host and keeps binding through reload", () => {
  const { shape: arrow, text, elements } = fixture("arrow");
  arrow.points = [[0, 0], [200, 0]];
  arrow.height = 0;
  syncBoundText(elements, arrow);
  assert.equal(getElementAtPosition(elements, { x: text.x + 2, y: text.y + 2 }, 1), arrow);
  assert.equal(getContainerOf(elements, text), arrow);
  assert.ok(expandWithBoundTexts(elements, [arrow.id]).has(text.id));
  const restored = parseSceneFile(JSON.stringify(serializeScene(elements, "white"))).elements;
  assert.equal(getContainerOf(restored, restored.find(el => el.type === "text"))?.id, arrow.id);
});
