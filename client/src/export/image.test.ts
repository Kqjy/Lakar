import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../../test/module-harness.mjs";

async function svgFor(elements, background = null) {
  let blob;
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const exportSVG = loadModule(new URL("./image.ts", import.meta.url), {
    Blob, getCommonBounds: () => bounds, getElementBounds: () => bounds,
    downloadBlob: value => { blob = value; }, themedColor: color => color,
    FONT_FAMILY_CSS: { hand: '"Kalam", cursive' },
    measureText: text => ({ lines: [text], lineWidths: [10], width: 10 }),
  }, "exportSVG");
  exportSVG({ elements, theme: "light", background }, "test.svg");
  return blob.text();
}
const image = dataURL => ({ type: "image", angle: 0, opacity: 100, width: 10, height: 10, dataURL });

test("SVG export rejects injected image markup and external image URLs", async () => {
  const svg = await svgFor([image('x"/><script>alert(1)</script><image href="x'), image("https://tracker.example/image.png")], 'red"/><script>alert(2)</script><rect fill="red');
  assert.doesNotMatch(svg, /<script|tracker\.example|alert/);
  assert.match(svg, /fill="transparent"/);
});

test("SVG export retains embedded images and escapes text and color attributes", async () => {
  const url = "data:image/png;base64,iVBORw0KGgo=";
  const svg = await svgFor([image(url), { type: "text", angle: 0, opacity: 100, x: 0, y: 0, fontSize: 20, fontFamily: "hand", lineHeight: 1.2, text: '<script>&"', strokeColor: 'red" onload="alert(1)', textAlign: "left" }], "#ffffff");
  assert.match(svg, /data:image\/png;base64,iVBORw0KGgo=/);
  assert.match(svg, /&lt;script&gt;&amp;&quot;/);
  assert.doesNotMatch(svg, /onload=|<script/);
});
