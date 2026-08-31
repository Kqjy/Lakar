import type {
  BindableElement,
  LinearElement,
  LakarElement,
  Point,
  PointBinding,
} from "./types";
import { isArrowElement, isBindableElement } from "./types";
import { getElementBounds, mutateElement, normalizeLinear } from "./elements";
import { clamp, rotatePoint } from "./math";

export const BINDING_THRESHOLD = 18;

const DEFAULT_GAP = 4;

const FOCUS_DAMPEN = 0.62;

const EPS = 1e-6;

const SETTLE_PASSES = 4;

const SETTLE_EPS = 0.01;

const centerOf = (el: LakarElement): Point => {
  const b = getElementBounds(el);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};

export const isBindableTarget = (el: LakarElement): el is BindableElement =>
  !el.isDeleted && !el.locked && isBindableElement(el);

export const getBindableAtPoint = (
  elements: readonly LakarElement[],
  p: Point,
  zoom: number,
  excludeIds?: ReadonlySet<string>,
): BindableElement | null => {
  const range = BINDING_THRESHOLD / zoom;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isBindableTarget(el)) continue;
    if (excludeIds?.has(el.id)) continue;
    const b = getElementBounds(el);
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const lp = el.angle ? rotatePoint(p, c, -el.angle) : p;
    if (
      lp.x >= b.minX - range &&
      lp.x <= b.maxX + range &&
      lp.y >= b.minY - range &&
      lp.y <= b.maxY + range
    ) {
      return el;
    }
  }
  return null;
};

export const makeBinding = (
  shape: LakarElement,
  at: Point,
): PointBinding => {
  const b = getElementBounds(shape);
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const lp = shape.angle ? rotatePoint(at, c, -shape.angle) : at;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  return {
    elementId: shape.id,
    fx: clamp((lp.x - c.x) / w, -0.5, 0.5) * FOCUS_DAMPEN,
    fy: clamp((lp.y - c.y) / h, -0.5, 0.5) * FOCUS_DAMPEN,
    gap: DEFAULT_GAP,
  };
};

const DIAMOND_FOCUS_LIMIT = 0.46;

const focusPoint = (shape: LakarElement, binding: PointBinding): Point => {
  const b = getElementBounds(shape);
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  let fx = binding.fx;
  let fy = binding.fy;
  if (shape.type === "diamond") {
    const sum = Math.abs(fx) + Math.abs(fy);
    if (sum > DIAMOND_FOCUS_LIMIT) {
      const k = DIAMOND_FOCUS_LIMIT / sum;
      fx *= k;
      fy *= k;
    }
  }
  const local = {
    x: c.x + fx * (b.maxX - b.minX),
    y: c.y + fy * (b.maxY - b.minY),
  };
  return shape.angle ? rotatePoint(local, c, shape.angle) : local;
};

const rayPolygonExit = (a: Point, d: Point, poly: Point[]): number | null => {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < EPS) continue;
    const t = ((p1.x - a.x) * ey - (p1.y - a.y) * ex) / den;
    const u = ((p1.x - a.x) * d.y - (p1.y - a.y) * d.x) / den;
    if (t > EPS && u >= -EPS && u <= 1 + EPS) {
      if (best === null || t < best) best = t;
    }
  }
  return best;
};

const rayEllipseExit = (
  a: Point,
  d: Point,
  c: Point,
  rx: number,
  ry: number,
): number | null => {
  if (rx < EPS || ry < EPS) return null;
  const ax = (a.x - c.x) / rx;
  const ay = (a.y - c.y) / ry;
  const dx = d.x / rx;
  const dy = d.y / ry;
  const qa = dx * dx + dy * dy;
  if (qa === 0) return null;
  const qb = 2 * (ax * dx + ay * dy);
  const qc = ax * ax + ay * ay - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-qb - sq) / (2 * qa);
  const t2 = (-qb + sq) / (2 * qa);
  const first = t1 > EPS ? t1 : Infinity;
  const second = t2 > EPS ? t2 : Infinity;
  const t = Math.min(first, second);
  return Number.isFinite(t) ? t : null;
};

const outlinePointToward = (
  shape: LakarElement,
  anchor: Point,
  toward: Point,
  gap: number,
): Point | null => {
  const b = getElementBounds(shape);
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const a = shape.angle ? rotatePoint(anchor, c, -shape.angle) : anchor;
  const f = shape.angle ? rotatePoint(toward, c, -shape.angle) : toward;
  const d = { x: f.x - a.x, y: f.y - a.y };
  const len = Math.hypot(d.x, d.y);
  if (len < EPS) return null;

  let t: number | null;
  if (shape.type === "ellipse") {
    t = rayEllipseExit(a, d, c, (b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2);
  } else if (shape.type === "diamond") {
    t = rayPolygonExit(a, d, [
      { x: c.x, y: b.minY },
      { x: b.maxX, y: c.y },
      { x: c.x, y: b.maxY },
      { x: b.minX, y: c.y },
    ]);
  } else {
    t = rayPolygonExit(a, d, [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ]);
  }
  if (t === null) return null;

  const ux = d.x / len;
  const uy = d.y / len;
  const local = {
    x: a.x + d.x * t + ux * gap,
    y: a.y + d.y * t + uy * gap,
  };
  return shape.angle ? rotatePoint(local, c, shape.angle) : local;
};

const bakeLinearRotation = (el: LinearElement) => {
  if (!el.angle) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of el.points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  if (minX === Infinity) return;
  const c = {
    x: el.x + (minX + maxX) / 2,
    y: el.y + (minY + maxY) / 2,
  };
  const scene = el.points.map(([px, py]) =>
    rotatePoint({ x: el.x + px, y: el.y + py }, c, el.angle),
  );
  mutateElement(el, {
    angle: 0,
    x: scene[0].x,
    y: scene[0].y,
    points: scene.map((p) => [p.x - scene[0].x, p.y - scene[0].y] as [number, number]),
  } as Partial<LinearElement>);
  normalizeLinear(el);
};

const clearBinding = (arrow: LinearElement, which: "start" | "end") => {
  mutateElement(arrow, {
    [which === "start" ? "startBinding" : "endBinding"]: null,
  } as Partial<LinearElement>);
};

export const updateBoundPoints = (
  byId: ReadonlyMap<string, LakarElement>,
  arrow: LinearElement,
): boolean => {
  if (!arrow.startBinding && !arrow.endBinding) return false;
  if (arrow.points.length < 2) return false;

  bakeLinearRotation(arrow);

  const points = arrow.points.map((p) => [...p] as [number, number]);
  let changed = false;

  const live: {
    binding: PointBinding;
    shape: LakarElement;
    idx: number;
    neighborIdx: number;
  }[] = [];

  for (const which of ["start", "end"] as const) {
    const binding = which === "start" ? arrow.startBinding : arrow.endBinding;
    if (!binding) continue;
    const shape = byId.get(binding.elementId);
    if (!shape || shape.isDeleted || !isBindableElement(shape)) {
      clearBinding(arrow, which);
      changed = true;
      continue;
    }
    const idx = which === "start" ? 0 : points.length - 1;
    const neighborIdx = which === "start" ? 1 : points.length - 2;
    if (neighborIdx < 0 || neighborIdx >= points.length) continue;
    live.push({ binding, shape, idx, neighborIdx });
  }

  let moved = false;
  for (let pass = 0; pass < SETTLE_PASSES && live.length; pass++) {
    let passMoved = false;
    for (const { binding, shape, idx, neighborIdx } of live) {
      const anchor = focusPoint(shape, binding);
      const toward = {
        x: arrow.x + points[neighborIdx][0],
        y: arrow.y + points[neighborIdx][1],
      };
      const edge = outlinePointToward(shape, anchor, toward, binding.gap);
      if (!edge) continue;
      const next: [number, number] = [edge.x - arrow.x, edge.y - arrow.y];
      if (
        Math.abs(next[0] - points[idx][0]) > SETTLE_EPS ||
        Math.abs(next[1] - points[idx][1]) > SETTLE_EPS
      ) {
        points[idx] = next;
        passMoved = true;
        moved = true;
      }
    }
    if (!passMoved) break;
  }

  if (moved) {
    mutateElement(arrow, { points } as Partial<LinearElement>);
    normalizeLinear(arrow);
  }
  return changed || moved;
};

export const updateBoundArrows = (
  elements: readonly LakarElement[],
  changedIds: ReadonlySet<string>,
): boolean => {
  if (!changedIds.size) return false;
  const byId = new Map(elements.map((el) => [el.id, el]));
  let any = false;
  for (const el of elements) {
    if (el.isDeleted || !isArrowElement(el)) continue;
    const touchesStart =
      el.startBinding && changedIds.has(el.startBinding.elementId);
    const touchesEnd = el.endBinding && changedIds.has(el.endBinding.elementId);
    if (!touchesStart && !touchesEnd && !changedIds.has(el.id)) continue;
    if (updateBoundPoints(byId, el)) any = true;
  }
  return any;
};

export const getBoundArrows = (
  elements: readonly LakarElement[],
  shapeIds: ReadonlySet<string>,
): LinearElement[] => {
  const out: LinearElement[] = [];
  for (const el of elements) {
    if (el.isDeleted || !isArrowElement(el)) continue;
    if (
      (el.startBinding && shapeIds.has(el.startBinding.elementId)) ||
      (el.endBinding && shapeIds.has(el.endBinding.elementId))
    ) {
      out.push(el);
    }
  }
  return out;
};

export const unbindArrowsFromMissing = (
  elements: readonly LakarElement[],
): boolean => {
  const live = new Set(
    elements.filter((el) => !el.isDeleted).map((el) => el.id),
  );
  let changed = false;
  for (const el of elements) {
    if (el.isDeleted || !isArrowElement(el)) continue;
    if (el.startBinding && !live.has(el.startBinding.elementId)) {
      clearBinding(el, "start");
      changed = true;
    }
    if (el.endBinding && !live.has(el.endBinding.elementId)) {
      clearBinding(el, "end");
      changed = true;
    }
  }
  return changed;
};

export const releaseBindingsNotMoving = (
  elements: readonly LakarElement[],
  movingIds: ReadonlySet<string>,
): boolean => {
  let changed = false;
  for (const el of elements) {
    if (el.isDeleted || !isArrowElement(el) || !movingIds.has(el.id)) continue;
    if (el.startBinding && !movingIds.has(el.startBinding.elementId)) {
      clearBinding(el, "start");
      changed = true;
    }
    if (el.endBinding && !movingIds.has(el.endBinding.elementId)) {
      clearBinding(el, "end");
      changed = true;
    }
  }
  return changed;
};

export const setArrowBinding = (
  arrow: LinearElement,
  which: "start" | "end",
  binding: PointBinding | null,
) => {
  const current = which === "start" ? arrow.startBinding : arrow.endBinding;
  if (current?.elementId === binding?.elementId) {
    if (!binding || !current) return;
    if (current.fx === binding.fx && current.fy === binding.fy) return;
  }
  mutateElement(arrow, {
    [which === "start" ? "startBinding" : "endBinding"]: binding,
  } as Partial<LinearElement>);
};

export const remapBindings = (
  el: LakarElement,
  idMap: ReadonlyMap<string, string>,
) => {
  if (!isArrowElement(el)) return;
  const remap = (b: PointBinding | null): PointBinding | null => {
    if (!b) return null;
    const next = idMap.get(b.elementId);
    return next ? { ...b, elementId: next } : null;
  };
  el.startBinding = remap(el.startBinding);
  el.endBinding = remap(el.endBinding);
};
