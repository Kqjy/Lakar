import { RoughCanvas } from "roughjs/bin/canvas";
import type { SatchelItem, Theme } from "../types";
import { getCommonBounds } from "../elements";
import { renderElement } from "../renderer/renderElement";
import { preloadImages } from "../renderer/imageCache";

const cache = new Map<string, string>();
let fontsReady: Promise<unknown> | null = null;

export const waitForFonts = () => {
  if (!fontsReady) {
    fontsReady = document.fonts?.ready ?? Promise.resolve();
  }
  return fontsReady;
};

export const renderItemPreview = (
  item: SatchelItem,
  theme: Theme,
  size = 112,
): string => {
  const key = `${item.id}:${theme}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d")!;

  const visible = item.elements.filter((el) => !el.isDeleted);
  if (!visible.length) return "";

  const bounds = getCommonBounds(visible);
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const inner = size - 18;
  const scale = Math.min(inner / w, inner / h, 1.5);

  ctx.setTransform(
    scale * dpr,
    0,
    0,
    scale * dpr,
    ((size - w * scale) / 2 - bounds.minX * scale) * dpr,
    ((size - h * scale) / 2 - bounds.minY * scale) * dpr,
  );

  const rc = new RoughCanvas(canvas);
  for (const el of visible) renderElement(ctx, rc, el, theme, 1, scale);

  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
};

export const primePreviewImages = (items: SatchelItem[]) =>
  preloadImages(
    items
      .flatMap((item) => item.elements)
      .filter((el) => el.type === "image")
      .map((el) => (el as { dataURL: string }).dataURL),
  );

export const dropPreviewCache = (itemId: string) => {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${itemId}:`)) cache.delete(key);
  }
};
