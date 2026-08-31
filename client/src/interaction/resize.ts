import type { Bounds, Point, LakarElement } from "../types";
import { isLinearLike, isTextElement } from "../types";
import { getElementBounds, mutateElement } from "../elements";
import type { HandleKind } from "../renderer/renderScene";
import { rotatePoint } from "../math";

export interface ElementSnapshot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  points?: [number, number][];
  pressures?: number[];
  fontSize?: number;
  text?: string;
}

export const snapshotElement = (el: LakarElement): ElementSnapshot => ({
  id: el.id,
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
  angle: el.angle,
  points: isLinearLike(el) ? el.points.map((p) => [...p] as [number, number]) : undefined,
  pressures: el.type === "freedraw" ? [...el.pressures] : undefined,
  fontSize: isTextElement(el) ? el.fontSize : undefined,
});

const snapshotBounds = (s: ElementSnapshot): Bounds => {
  if (s.points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (minX === Infinity) { minX = minY = maxX = maxY = 0; }
    return { minX: s.x + minX, minY: s.y + minY, maxX: s.x + maxX, maxY: s.y + maxY };
  }
  return {
    minX: Math.min(s.x, s.x + s.width),
    minY: Math.min(s.y, s.y + s.height),
    maxX: Math.max(s.x, s.x + s.width),
    maxY: Math.max(s.y, s.y + s.height),
  };
};

export const scaleElementFromSnapshot = (
  el: LakarElement,
  snap: ElementSnapshot,
  anchor: Point,
  scaleX: number,
  scaleY: number,
) => {
  const b = snapshotBounds(snap);
  const w0 = b.maxX - b.minX;
  const h0 = b.maxY - b.minY;

  const newMinX = anchor.x + (b.minX - anchor.x) * scaleX;
  const newMinY = anchor.y + (b.minY - anchor.y) * scaleY;
  const newMaxX = anchor.x + (b.maxX - anchor.x) * scaleX;
  const newMaxY = anchor.y + (b.maxY - anchor.y) * scaleY;
  const minX = Math.min(newMinX, newMaxX);
  const minY = Math.min(newMinY, newMaxY);
  const w1 = Math.abs(newMaxX - newMinX);
  const h1 = Math.abs(newMaxY - newMinY);
  const fx = w0 ? w1 / w0 : 1;
  const fy = h0 ? h1 / h0 : 1;
  const flippedX = scaleX < 0;
  const flippedY = scaleY < 0;

  if (snap.points) {

    let minPX = Infinity, minPY = Infinity, maxPX = -Infinity, maxPY = -Infinity;
    for (const [x, y] of snap.points) {
      minPX = Math.min(minPX, x); minPY = Math.min(minPY, y);
      maxPX = Math.max(maxPX, x); maxPY = Math.max(maxPY, y);
    }
    if (minPX === Infinity) { minPX = minPY = maxPX = maxPY = 0; }
    const spanX = maxPX - minPX;
    const spanY = maxPY - minPY;
    const points = snap.points.map(([x, y]) => {
      let nx = (x - minPX) * fx;
      let ny = (y - minPY) * fy;
      if (flippedX) nx = spanX * fx - nx;
      if (flippedY) ny = spanY * fy - ny;
      return [nx, ny] as [number, number];
    });
    mutateElement(el, {
      x: minX,
      y: minY,
      width: w1,
      height: h1,
      points,
    } as Partial<LakarElement>);
    return;
  }

  if (isTextElement(el) && snap.fontSize) {

    const f = Math.abs(h0 > 0 ? fy : fx);
    const fontSize = Math.max(4, snap.fontSize * f);
    mutateElement(el, { fontSize, x: minX, y: minY });

    return;
  }

  mutateElement(el, {
    x: minX,
    y: minY,
    width: w1,
    height: h1,
  } as Partial<LakarElement>);
};

export interface ResizeContext {
  handle: HandleKind;
  originalBounds: Bounds;
  
  angle: number;
  snapshots: ElementSnapshot[];
}

export const computeResize = (
  ctx: ResizeContext,
  pointer: Point,
  keepAspect: boolean,
  fromCenter: boolean,
): { anchor: Point; scaleX: number; scaleY: number } => {
  const b = ctx.originalBounds;
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const k = ctx.handle;

  const east = k.includes("e");
  const west = k.includes("w");
  const north = k.includes("n");
  const south = k.includes("s");

  const anchor: Point = fromCenter
    ? { x: cx, y: cy }
    : {
        x: east ? b.minX : west ? b.maxX : cx,
        y: south ? b.minY : north ? b.maxY : cy,
      };

  let scaleX = 1;
  let scaleY = 1;
  const half = fromCenter ? 2 : 1;

  if (east) scaleX = ((pointer.x - anchor.x) * half) / w;
  if (west) scaleX = (-(pointer.x - anchor.x) * half) / w;
  if (south) scaleY = ((pointer.y - anchor.y) * half) / h;
  if (north) scaleY = (-(pointer.y - anchor.y) * half) / h;

  if (keepAspect) {
    const corner = (east || west) && (north || south);
    if (corner) {
      const m = Math.max(Math.abs(scaleX), Math.abs(scaleY));
      scaleX = Math.sign(scaleX || 1) * m;
      scaleY = Math.sign(scaleY || 1) * m;
    } else if (east || west) {
      scaleY = Math.abs(scaleX);
    } else {
      scaleX = Math.abs(scaleY);
    }
  } else {
    if (!(east || west)) scaleX = 1;
    if (!(north || south)) scaleY = 1;
  }

  return { anchor, scaleX, scaleY };
};

export const fixCenterAfterRotatedResize = (
  el: LakarElement,
  originalCenter: Point,
) => {
  if (!el.angle) return;
  const b = getElementBounds(el);
  const c1 = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const rotated = rotatePoint(c1, originalCenter, el.angle);
  const dx = rotated.x - c1.x;
  const dy = rotated.y - c1.y;
  mutateElement(el, { x: el.x + dx, y: el.y + dy } as Partial<LakarElement>);
};

export const cursorForHandle = (kind: HandleKind, angle: number): string => {
  if (kind === "rotation") return "grab";
  const dirs: HandleKind[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const cursors = [
    "ns-resize", "nesw-resize", "ew-resize", "nwse-resize",
    "ns-resize", "nesw-resize", "ew-resize", "nwse-resize",
  ];
  const idx = dirs.indexOf(kind);
  if (idx < 0) return "default";
  const step = Math.round(angle / (Math.PI / 4));
  return cursors[(idx + step + 8000) % 8];
};
