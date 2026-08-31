import { nanoid } from "nanoid";
import type {
  Bounds,
  ElementType,
  FreedrawElement,
  ItemDefaults,
  LinearElement,
  Point,
  TextElement,
  LakarElement,
} from "./types";
import { isLinearLike, isTextElement } from "./types";
import {
  boundsFromPoints,
  mergeBounds,
  randomSeed,
  rotatePoint,
} from "./math";
import { measureText } from "./text/measure";

export const newVersionNonce = () => Math.floor(Math.random() * 2 ** 31);

export const newElementId = () => nanoid(16);

interface CreateOpts {
  type: ElementType;
  x: number;
  y: number;
  defaults: ItemDefaults;
}

export const createElement = ({
  type,
  x,
  y,
  defaults,
}: CreateOpts): LakarElement => {
  const base = {
    id: newElementId(),
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: defaults.strokeColor,
    backgroundColor: defaults.backgroundColor,
    fillStyle: defaults.fillStyle,
    strokeWidth: defaults.strokeWidth,
    strokeStyle: defaults.strokeStyle,
    roughness: defaults.roughness,
    opacity: defaults.opacity,
    roundEdges: defaults.roundEdges,
    seed: randomSeed(),
    version: 1,
    versionNonce: newVersionNonce(),
    isDeleted: false,
    groupIds: [] as string[],
    locked: false,
  };
  switch (type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      return { ...base, type };
    case "line":
    case "arrow":
      return {
        ...base,
        type,
        points: [[0, 0]],
        startArrowhead: type === "arrow" ? defaults.startArrowhead : "none",
        endArrowhead: type === "arrow" ? defaults.endArrowhead : "none",
        startBinding: null,
        endBinding: null,
      };
    case "freedraw":
      return { ...base, type, points: [[0, 0]], pressures: [0.5] };
    case "text":
      return {
        ...base,
        type,
        text: "",
        fontSize: defaults.fontSize,
        fontFamily: defaults.fontFamily,
        textAlign: defaults.textAlign,
        lineHeight: 1.25,
        containerId: null,
      };
    case "image":
      return { ...base, type, dataURL: "" };
    case "frame":
      return {
        ...base,
        type,
        name: "Frame",
        strokeColor: "#26241f",
        backgroundColor: "transparent",
        angle: 0,
      };
  }
};

export const mutateElement = <T extends LakarElement>(
  el: T,
  updates: Partial<T>,
): T => {
  Object.assign(el, updates);
  el.version = (el.version || 0) + 1;
  el.versionNonce = newVersionNonce();
  return el;
};

export const getElementBounds = (el: LakarElement): Bounds => {
  if (isLinearLike(el)) {
    const b = boundsFromPoints(el.points);
    return {
      minX: el.x + b.minX,
      minY: el.y + b.minY,
      maxX: el.x + b.maxX,
      maxY: el.y + b.maxY,
    };
  }

  const x1 = Math.min(el.x, el.x + el.width);
  const y1 = Math.min(el.y, el.y + el.height);
  const x2 = Math.max(el.x, el.x + el.width);
  const y2 = Math.max(el.y, el.y + el.height);
  return { minX: x1, minY: y1, maxX: x2, maxY: y2 };
};

export const getRotatedBounds = (el: LakarElement): Bounds => {
  const b = getElementBounds(el);
  if (!el.angle) return b;
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const corners = [
    rotatePoint({ x: b.minX, y: b.minY }, c, el.angle),
    rotatePoint({ x: b.maxX, y: b.minY }, c, el.angle),
    rotatePoint({ x: b.maxX, y: b.maxY }, c, el.angle),
    rotatePoint({ x: b.minX, y: b.maxY }, c, el.angle),
  ];
  return boundsFromPoints(corners.map((p) => [p.x, p.y]));
};

export const getElementCenter = (el: LakarElement): Point => {
  const b = getElementBounds(el);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};

export const LINK_BADGE_SIZE = 20;

export interface LinkBadge {
  cx: number;
  cy: number;
  r: number;
}

export const linkBadgeFor = (el: LakarElement, zoom: number): LinkBadge => {
  const b = getRotatedBounds(el);
  return { cx: b.maxX, cy: b.minY, r: LINK_BADGE_SIZE / 2 / zoom };
};

export const getCommonBounds = (els: readonly LakarElement[]): Bounds => {
  let acc: Bounds | null = null;
  for (const el of els) {
    const b = getRotatedBounds(el);
    acc = acc ? mergeBounds(acc, b) : b;
  }
  return acc ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
};

export const normalizeElement = (el: LakarElement) => {
  if (isLinearLike(el) || isTextElement(el)) return;
  if (el.width < 0) {
    mutateElement(el, { x: el.x + el.width, width: -el.width } as Partial<LakarElement>);
  }
  if (el.height < 0) {
    mutateElement(el, { y: el.y + el.height, height: -el.height } as Partial<LakarElement>);
  }
};

export const normalizeLinear = (el: LinearElement | FreedrawElement) => {
  const b = boundsFromPoints(el.points);
  if (b.minX === 0 && b.minY === 0) {
    mutateElement(el, {
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
    } as Partial<typeof el>);
    return;
  }
  mutateElement(el, {
    x: el.x + b.minX,
    y: el.y + b.minY,
    points: el.points.map(([px, py]) => [px - b.minX, py - b.minY]) as [
      number,
      number,
    ][],
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  } as Partial<typeof el>);
};

export const refreshTextDimensions = (el: TextElement, keepAnchor = false) => {
  const metrics = measureText(el.text, el.fontFamily, el.fontSize, el.lineHeight);
  if (keepAnchor && !el.containerId && el.width > 0) {
    const shift =
      el.textAlign === "center"
        ? (el.width - metrics.width) / 2
        : el.textAlign === "right"
          ? el.width - metrics.width
          : 0;
    mutateElement(el, {
      x: el.x + shift,
      width: metrics.width,
      height: metrics.height,
    });
    return;
  }
  mutateElement(el, { width: metrics.width, height: metrics.height });
};

export const duplicateElement = (
  el: LakarElement,
  offset = 12,
): LakarElement => {
  const copy = JSON.parse(JSON.stringify(el)) as LakarElement;
  copy.id = newElementId();
  copy.seed = randomSeed();
  copy.x += offset;
  copy.y += offset;
  copy.version = 1;
  copy.versionNonce = newVersionNonce();
  return copy;
};
