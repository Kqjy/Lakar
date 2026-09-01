import type { Bounds, Point, TextElement, LakarElement } from "./types";
import { isBoundText, isContainerElement, isLinearLike } from "./types";
import { getElementBounds, getRotatedBounds } from "./elements";
import {
  boundsContain,
  distToSegment,
  pointInBounds,
  rotatePoint,
} from "./math";

const pointInPolygon = (p: Point, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const nearPolyline = (p: Point, pts: Point[], threshold: number): boolean => {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(p, pts[i], pts[i + 1]) <= threshold) return true;
  }
  return pts.length === 1 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= threshold;
};

export const hitTestElement = (
  el: LakarElement,
  scenePoint: Point,
  zoom: number,
): boolean => {
  const threshold = Math.max(10 / zoom, el.strokeWidth / 2 + 4 / zoom);
  const bounds = getElementBounds(el);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  const p = el.angle ? rotatePoint(scenePoint, center, -el.angle) : scenePoint;

  if (el.type === "frame") {
    const labelH = 24 / zoom;
    if (
      p.x >= bounds.minX &&
      p.x <= Math.min(bounds.maxX, bounds.minX + 160 / zoom) &&
      p.y >= bounds.minY - labelH &&
      p.y <= bounds.minY
    ) {
      return true;
    }
    if (!pointInBounds(p, bounds, threshold)) return false;
    return (
      Math.abs(p.x - bounds.minX) <= threshold ||
      Math.abs(p.x - bounds.maxX) <= threshold ||
      Math.abs(p.y - bounds.minY) <= threshold ||
      Math.abs(p.y - bounds.maxY) <= threshold
    );
  }

  if (!pointInBounds(p, bounds, threshold)) return false;

  const filled = el.backgroundColor !== "transparent";

  switch (el.type) {
    case "text":
    case "image":
      return true;
    case "rectangle": {
      if (filled) return true;
      const near =
        Math.abs(p.x - bounds.minX) <= threshold ||
        Math.abs(p.x - bounds.maxX) <= threshold ||
        Math.abs(p.y - bounds.minY) <= threshold ||
        Math.abs(p.y - bounds.maxY) <= threshold;
      return near;
    }
    case "ellipse": {
      const rx = (bounds.maxX - bounds.minX) / 2;
      const ry = (bounds.maxY - bounds.minY) / 2;
      if (rx < 1 || ry < 1) return true;
      const dx = (p.x - center.x) / rx;
      const dy = (p.y - center.y) / ry;
      const d = Math.hypot(dx, dy);
      if (filled) return d <= 1 + threshold / Math.min(rx, ry);
      return Math.abs(d - 1) <= threshold / Math.min(rx, ry);
    }
    case "diamond": {
      const poly: Point[] = [
        { x: center.x, y: bounds.minY },
        { x: bounds.maxX, y: center.y },
        { x: center.x, y: bounds.maxY },
        { x: bounds.minX, y: center.y },
      ];
      if (filled && pointInPolygon(p, poly)) return true;
      return nearPolyline(p, [...poly, poly[0]], threshold);
    }
    case "line":
    case "arrow":
    case "freedraw": {
      const pts: Point[] = el.points.map(([px, py]) => ({
        x: el.x + px,
        y: el.y + py,
      }));
      if (
        el.type === "line" &&
        filled &&
        el.points.length > 2 &&
        pointInPolygon(p, pts)
      ) {
        return true;
      }
      const t =
        el.type === "freedraw"
          ? threshold + el.strokeWidth * 2
          : threshold;
      return nearPolyline(p, pts, t);
    }
  }
};

export const getElementAtPosition = (
  elements: readonly LakarElement[],
  scenePoint: Point,
  zoom: number,
  { includeLocked = false }: { includeLocked?: boolean } = {},
): LakarElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || (el.locked && !includeLocked)) continue;
    if (isBoundText(el)) continue;
    if (hitTestElement(el, scenePoint, zoom)) return el;
  }
  return null;
};

export const getFillableAtPosition = (
  elements: readonly LakarElement[],
  scenePoint: Point,
  zoom: number,
): LakarElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || el.locked) continue;
    if (
      el.type !== "rectangle" &&
      el.type !== "diamond" &&
      el.type !== "ellipse" &&
      el.type !== "line"
    ) {
      continue;
    }
    if (hitTestElement({ ...el, backgroundColor: "#000" }, scenePoint, zoom)) {
      return el;
    }
  }
  return null;
};

export const getTextAtPosition = (
  elements: readonly LakarElement[],
  scenePoint: Point,
  zoom: number,
): TextElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || el.locked || el.type !== "text" || isBoundText(el)) {
      continue;
    }
    if (hitTestElement(el, scenePoint, zoom)) return el;
  }
  return null;
};

export const getContainerAtPosition = (
  elements: readonly LakarElement[],
  scenePoint: Point,
): LakarElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || el.locked || !isContainerElement(el)) continue;
    const bounds = getElementBounds(el);
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const p = el.angle ? rotatePoint(scenePoint, center, -el.angle) : scenePoint;
    if (pointInBounds(p, bounds)) return el;
  }
  return null;
};

export const getElementsInBounds = (
  elements: readonly LakarElement[],
  bounds: Bounds,
): LakarElement[] =>
  elements.filter(
    (el) =>
      !el.isDeleted &&
      !el.locked &&
      !isBoundText(el) &&
      boundsContain(bounds, getRotatedBounds(el)),
  );
