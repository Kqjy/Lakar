import { RoughCanvas } from "roughjs/bin/canvas";
import type {
  Bounds,
  Point,
  Theme,
  LakarElement,
  Viewport,
} from "../types";
import { isFrameElement, isLinearLike } from "../types";
import {
  getCommonBounds,
  getElementBounds,
  getRotatedBounds,
  linkBadgeFor,
} from "../elements";
import { boundsOverlap, rotatePoint } from "../math";
import { renderElement } from "./renderElement";
import { themedColor } from "../colors";
import type { SnapGuide } from "../interaction/snap";

export const GUIDE_COLOR = { light: "#db2777", dark: "#f472b6" };

export const SELECTION_COLOR = { light: "#0f766e", dark: "#2dd4bf" };

export interface StaticRenderConfig {
  canvas: HTMLCanvasElement;
  elements: readonly LakarElement[];
  viewport: Viewport;
  theme: Theme;
  canvasBg: string;
  pendingEraseIds: ReadonlySet<string>;
  gridSize: number | null;
  width: number;
  height: number;
  dpr: number;
}

let rcCache = new WeakMap<HTMLCanvasElement, RoughCanvas>();
const getRC = (canvas: HTMLCanvasElement) => {
  let rc = rcCache.get(canvas);
  if (!rc) {
    rc = new RoughCanvas(canvas);
    rcCache.set(canvas, rc);
  }
  return rc;
};

export const renderStaticScene = (cfg: StaticRenderConfig) => {
  const { canvas, elements, viewport, theme, canvasBg, pendingEraseIds, gridSize, width, height, dpr } = cfg;
  const ctx = canvas.getContext("2d")!;
  const rc = getRC(canvas);
  const { scrollX, scrollY, zoom } = viewport;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = themedColor(canvasBg, theme);
  ctx.fillRect(0, 0, width * dpr, height * dpr);

  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * zoom * dpr, -scrollY * zoom * dpr);

  const view: Bounds = {
    minX: scrollX,
    minY: scrollY,
    maxX: scrollX + width / zoom,
    maxY: scrollY + height / zoom,
  };

  if (gridSize && gridSize * zoom >= 5) {
    ctx.save();
    ctx.strokeStyle = theme === "dark" ? "#ffffff14" : "#00000012";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    for (
      let x = Math.floor(view.minX / gridSize) * gridSize;
      x <= view.maxX;
      x += gridSize
    ) {
      ctx.moveTo(x, view.minY);
      ctx.lineTo(x, view.maxY);
    }
    for (
      let y = Math.floor(view.minY / gridSize) * gridSize;
      y <= view.maxY;
      y += gridSize
    ) {
      ctx.moveTo(view.minX, y);
      ctx.lineTo(view.maxX, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  const frames = new Map<string, LakarElement>();
  for (const el of elements) {
    if (!el.isDeleted && isFrameElement(el)) frames.set(el.id, el);
  }

  const visible = (el: LakarElement) => {
    const b = getRotatedBounds(el);
    const pad = el.strokeWidth * 4 + 20 + (isFrameElement(el) ? 30 / zoom : 0);
    return boundsOverlap(
      { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad },
      view,
    );
  };

  for (const el of frames.values()) {
    if (!visible(el)) continue;
    renderElement(ctx, rc, el, theme, pendingEraseIds.has(el.id) ? 0.25 : 1, zoom);
  }

  for (const el of elements) {
    if (el.isDeleted || isFrameElement(el) || !visible(el)) continue;
    const opacity = pendingEraseIds.has(el.id) ? 0.25 : 1;
    const frame = el.frameId ? frames.get(el.frameId) : undefined;
    if (frame) {
      const fb = getElementBounds(frame);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fb.minX, fb.minY, fb.maxX - fb.minX, fb.maxY - fb.minY);
      ctx.clip();
      renderElement(ctx, rc, el, theme, opacity, zoom);
      ctx.restore();
    } else {
      renderElement(ctx, rc, el, theme, opacity, zoom);
    }
  }
};

export type HandleKind =
  | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
  | "rotation";

export interface TransformHandle {
  kind: HandleKind;
  
  x: number;
  y: number;
}

export const SELECTION_PAD = 6;

export const getTransformHandles = (
  bounds: Bounds,
  angle: number,
  zoom: number,
): TransformHandle[] => {
  const pad = SELECTION_PAD / zoom;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const maxX = bounds.maxX + pad;
  const maxY = bounds.maxY + pad;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rotOffset = 22 / zoom;
  const raw: [HandleKind, number, number][] = [
    ["nw", minX, minY],
    ["n", cx, minY],
    ["ne", maxX, minY],
    ["e", maxX, cy],
    ["se", maxX, maxY],
    ["s", cx, maxY],
    ["sw", minX, maxY],
    ["w", minX, cy],
    ["rotation", cx, minY - rotOffset],
  ];
  const c = { x: cx, y: cy };
  return raw.map(([kind, x, y]) => {
    const p = rotatePoint({ x, y }, c, angle);
    return { kind, x: p.x, y: p.y };
  });
};

export interface InteractiveRenderConfig {
  canvas: HTMLCanvasElement;
  selectedElements: readonly LakarElement[];
  viewport: Viewport;
  theme: Theme;
  width: number;
  height: number;
  dpr: number;
  rubberBand: Bounds | null;

  editingLinear: LakarElement | null;
  hideHandles: boolean;
  hideRotation: boolean;
  remoteSelections: { color: string; elements: LakarElement[] }[];
  bindingHighlight: LakarElement | null;
  snapGuides: readonly SnapGuide[];
  linkedElements: readonly LakarElement[];
}

export const renderInteractiveScene = (cfg: InteractiveRenderConfig) => {
  const {
    canvas, selectedElements, viewport, theme, width, height, dpr,
    rubberBand, editingLinear, hideHandles, hideRotation, remoteSelections,
    bindingHighlight, snapGuides, linkedElements,
  } = cfg;
  const ctx = canvas.getContext("2d")!;
  const { scrollX, scrollY, zoom } = viewport;
  const accent = SELECTION_COLOR[theme];

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * zoom * dpr, -scrollY * zoom * dpr);

  const drawBox = (b: Bounds, angle: number, dashed: boolean) => {
    const pad = SELECTION_PAD / zoom;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (angle) ctx.rotate(angle);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2 / zoom;
    ctx.setLineDash(dashed ? [4 / zoom, 4 / zoom] : []);
    ctx.strokeRect(
      -(b.maxX - b.minX) / 2 - pad,
      -(b.maxY - b.minY) / 2 - pad,
      b.maxX - b.minX + pad * 2,
      b.maxY - b.minY + pad * 2,
    );
    ctx.restore();
  };

  if (bindingHighlight) {
    const b = getRotatedBoundsUnrotated(bindingHighlight);
    const pad = 4 / zoom;
    const w = b.maxX - b.minX + pad * 2;
    const h = b.maxY - b.minY + pad * 2;
    ctx.save();
    ctx.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    if (bindingHighlight.angle) ctx.rotate(bindingHighlight.angle);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5 / zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6 / zoom);
    ctx.stroke();
    ctx.restore();
  }

  for (const remote of remoteSelections) {
    for (const el of remote.elements) {
      const b = getRotatedBoundsUnrotated(el);
      const pad = (SELECTION_PAD + 2) / zoom;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (el.angle) ctx.rotate(el.angle);
      ctx.strokeStyle = remote.color;
      ctx.lineWidth = 1.6 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeRect(
        -(b.maxX - b.minX) / 2 - pad,
        -(b.maxY - b.minY) / 2 - pad,
        b.maxX - b.minX + pad * 2,
        b.maxY - b.minY + pad * 2,
      );
      ctx.restore();
    }
  }

  const multi = selectedElements.length > 1;

  for (const el of selectedElements) {
    if (editingLinear && el.id === editingLinear.id) continue;
    drawBox(getRotatedBoundsUnrotated(el), multi ? el.angle : el.angle, false);
  }

  if (selectedElements.length > 0 && !hideHandles) {
    let bounds: Bounds;
    let angle = 0;
    if (!multi) {
      const el = selectedElements[0];
      bounds = getRotatedBoundsUnrotated(el);
      angle = el.angle;
    } else {
      bounds = getCommonBounds(selectedElements);
      drawBox(bounds, 0, true);
    }

    if (!(editingLinear && !multi)) {
      const handles = getTransformHandles(bounds, angle, zoom).filter(
        (h) => !(hideRotation && h.kind === "rotation"),
      );
      const size = 8 / zoom;
      for (const h of handles) {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(angle);
        ctx.fillStyle = theme === "dark" ? "#20201d" : "#ffffff";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.2 / zoom;
        if (h.kind === "rotation") {
          ctx.beginPath();
          ctx.arc(0, 0, size / 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const r = 2 / zoom;
          ctx.beginPath();
          ctx.roundRect(-size / 2, -size / 2, size, size, r);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  if (editingLinear && isLinearLike(editingLinear)) {
    const el = editingLinear;
    const r = 5 / zoom;
    ctx.save();
    for (const [px, py] of el.points) {
      const p = rotateLocalPoint(el, px, py);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = theme === "dark" ? "#20201d" : "#ffffff";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4 / zoom;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  if (rubberBand) {
    ctx.save();
    ctx.fillStyle = accent + "18";
    ctx.strokeStyle = accent + "aa";
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(
      rubberBand.minX,
      rubberBand.minY,
      rubberBand.maxX - rubberBand.minX,
      rubberBand.maxY - rubberBand.minY,
    );
    ctx.strokeRect(
      rubberBand.minX,
      rubberBand.minY,
      rubberBand.maxX - rubberBand.minX,
      rubberBand.maxY - rubberBand.minY,
    );
    ctx.restore();
  }

  for (const el of linkedElements) {
    const badge = linkBadgeFor(el, zoom);
    const view: Bounds = {
      minX: scrollX,
      minY: scrollY,
      maxX: scrollX + width / zoom,
      maxY: scrollY + height / zoom,
    };
    if (
      badge.cx < view.minX - badge.r ||
      badge.cx > view.maxX + badge.r ||
      badge.cy < view.minY - badge.r ||
      badge.cy > view.maxY + badge.r
    ) {
      continue;
    }
    const a = badge.r * 0.44;
    ctx.save();
    ctx.translate(badge.cx, badge.cy);
    ctx.beginPath();
    ctx.arc(0, 0, badge.r, 0, Math.PI * 2);
    ctx.fillStyle = theme === "dark" ? "#20201d" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3 / zoom;
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5 / zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-a, a);
    ctx.lineTo(a, -a);
    ctx.moveTo(-a * 0.2, -a);
    ctx.lineTo(a, -a);
    ctx.lineTo(a, a * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  if (snapGuides.length) {
    const pad = 12 / zoom;
    ctx.save();
    ctx.strokeStyle = GUIDE_COLOR[theme];
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.beginPath();
    for (const g of snapGuides) {
      if (g.axis === "x") {
        ctx.moveTo(g.pos, g.from - pad);
        ctx.lineTo(g.pos, g.to + pad);
      } else {
        ctx.moveTo(g.from - pad, g.pos);
        ctx.lineTo(g.to + pad, g.pos);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
};

const getRotatedBoundsUnrotated = (el: LakarElement): Bounds => {
  if (isLinearLike(el)) {

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of el.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    return {
      minX: el.x + minX,
      minY: el.y + minY,
      maxX: el.x + maxX,
      maxY: el.y + maxY,
    };
  }
  const x1 = Math.min(el.x, el.x + el.width);
  const y1 = Math.min(el.y, el.y + el.height);
  const x2 = Math.max(el.x, el.x + el.width);
  const y2 = Math.max(el.y, el.y + el.height);
  return { minX: x1, minY: y1, maxX: x2, maxY: y2 };
};

export const rotateLocalPoint = (
  el: LakarElement & { points?: [number, number][] },
  px: number,
  py: number,
): Point => {
  const b = getRotatedBoundsUnrotated(el);
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  return rotatePoint({ x: el.x + px, y: el.y + py }, c, el.angle);
};

export { getRotatedBoundsUnrotated };
