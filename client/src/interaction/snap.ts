import type { Bounds, LakarElement } from "../types";
import { isBoundText } from "../types";
import { getRotatedBounds } from "../elements";

export const SNAP_THRESHOLD = 6;

export const GRID_SIZES = [10, 20, 40] as const;

export interface SnapGuide {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [] };

const snapToGrid = (value: number, gridSize: number) =>
  Math.round(value / gridSize) * gridSize - value;

interface AxisHit {
  delta: number;
  pos: number;
  ref: Bounds;
}

export const computeSnap = (
  elements: readonly LakarElement[],
  excludeIds: ReadonlySet<string>,
  bounds: Bounds,
  zoom: number,
  gridSize: number | null,
  enabled: boolean,
): SnapResult => {
  if (!enabled && !gridSize) return NO_SNAP;

  const threshold = SNAP_THRESHOLD / zoom;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const selfX = [bounds.minX, cx, bounds.maxX];
  const selfY = [bounds.minY, cy, bounds.maxY];

  let bestX: AxisHit | null = null;
  let bestY: AxisHit | null = null;

  if (enabled) {
    for (const el of elements) {
      if (el.isDeleted || excludeIds.has(el.id) || isBoundText(el)) continue;
      const t = getRotatedBounds(el);
      const tx = [t.minX, (t.minX + t.maxX) / 2, t.maxX];
      const ty = [t.minY, (t.minY + t.maxY) / 2, t.maxY];
      for (const s of selfX) {
        for (const v of tx) {
          const delta = v - s;
          if (
            Math.abs(delta) <= threshold &&
            (!bestX || Math.abs(delta) < Math.abs(bestX.delta))
          ) {
            bestX = { delta, pos: v, ref: t };
          }
        }
      }
      for (const s of selfY) {
        for (const v of ty) {
          const delta = v - s;
          if (
            Math.abs(delta) <= threshold &&
            (!bestY || Math.abs(delta) < Math.abs(bestY.delta))
          ) {
            bestY = { delta, pos: v, ref: t };
          }
        }
      }
    }
  }

  let dx = bestX?.delta ?? 0;
  let dy = bestY?.delta ?? 0;

  if (gridSize) {
    if (!bestX) dx = snapToGrid(bounds.minX, gridSize);
    if (!bestY) dy = snapToGrid(bounds.minY, gridSize);
  }

  const guides: SnapGuide[] = [];
  if (bestX) {
    guides.push({
      axis: "x",
      pos: bestX.pos,
      from: Math.min(bounds.minY + dy, bestX.ref.minY),
      to: Math.max(bounds.maxY + dy, bestX.ref.maxY),
    });
  }
  if (bestY) {
    guides.push({
      axis: "y",
      pos: bestY.pos,
      from: Math.min(bounds.minX + dx, bestY.ref.minX),
      to: Math.max(bounds.maxX + dx, bestY.ref.maxX),
    });
  }

  return { dx, dy, guides };
};

export const snapPointToGrid = (
  x: number,
  y: number,
  gridSize: number | null,
): { x: number; y: number } => {
  if (!gridSize) return { x, y };
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize,
  };
};
