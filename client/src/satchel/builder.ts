import type {
  Arrowhead,
  FillStyle,
  FontFamily,
  LakarElement,
  StrokeStyle,
  TextAlign,
  TextElement,
} from "../types";
import { newElementId, newVersionNonce } from "../elements";
import { measureText } from "../text/measure";

export const INK = "#26241f";
export const INK_SOFT = "#6e6a61";
export const TINT_BLUE = "#c6daf3";
export const TINT_GREEN = "#cbe5ce";
export const TINT_RED = "#f6caca";
export const TINT_SAND = "#f5e3af";
export const TINT_LILAC = "#d0bfff";
export const TINT_PAPER = "#e6dcd4";
export const ACCENT_RED = "#c94040";
export const ACCENT_GREEN = "#3a7d44";
export const ACCENT_BLUE = "#3563c9";
export const ACCENT_AMBER = "#c77b1e";

export interface SatchelDef {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  build: () => LakarElement[];
}

export interface Style {
  stroke?: string;
  fill?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: number;
  opacity?: number;
  round?: boolean;
  angle?: number;
  seed?: number;
}

export interface TextStyle extends Style {
  size?: number;
  font?: FontFamily;
  align?: TextAlign;
}

let seedCounter = 7;
const nextSeed = () => {
  seedCounter = (seedCounter * 1103515245 + 12345) % 2147483647;
  return seedCounter;
};

const base = (style: Style = {}) => ({
  id: newElementId(),
  angle: style.angle ?? 0,
  strokeColor: style.stroke ?? INK,
  backgroundColor: style.fill ?? "transparent",
  fillStyle: style.fillStyle ?? "solid",
  strokeWidth: style.strokeWidth ?? 1.5,
  strokeStyle: style.strokeStyle ?? "solid",
  roughness: style.roughness ?? 0.9,
  opacity: style.opacity ?? 100,
  roundEdges: style.round ?? false,
  seed: style.seed ?? nextSeed(),
  version: 1,
  versionNonce: newVersionNonce(),
  isDeleted: false,
  groupIds: [] as string[],
  frameId: null,
  locked: false,
});

export const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  style: Style = {},
): LakarElement => ({
  ...base(style),
  type: "rectangle",
  x,
  y,
  width: w,
  height: h,
});

export const ellipse = (
  x: number,
  y: number,
  w: number,
  h: number,
  style: Style = {},
): LakarElement => ({
  ...base(style),
  type: "ellipse",
  x,
  y,
  width: w,
  height: h,
});

export const diamond = (
  x: number,
  y: number,
  w: number,
  h: number,
  style: Style = {},
): LakarElement => ({
  ...base(style),
  type: "diamond",
  x,
  y,
  width: w,
  height: h,
});

const normalizePoints = (points: [number, number][]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return {
    origin: [minX, minY] as [number, number],
    local: points.map(([px, py]) => [px - minX, py - minY] as [number, number]),
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const line = (
  points: [number, number][],
  style: Style = {},
): LakarElement => {
  const { origin, local, width, height } = normalizePoints(points);
  return {
    ...base(style),
    type: "line",
    x: origin[0],
    y: origin[1],
    width,
    height,
    points: local,
    startArrowhead: "none",
    endArrowhead: "none",
    startBinding: null,
    endBinding: null,
  };
};

export const arrow = (
  points: [number, number][],
  style: Style & { start?: Arrowhead; end?: Arrowhead } = {},
): LakarElement => {
  const { origin, local, width, height } = normalizePoints(points);
  return {
    ...base(style),
    type: "arrow",
    x: origin[0],
    y: origin[1],
    width,
    height,
    points: local,
    startArrowhead: style.start ?? "none",
    endArrowhead: style.end ?? "arrow",
    startBinding: null,
    endBinding: null,
  };
};

export const ink = (
  points: [number, number][],
  style: Style = {},
): LakarElement => {
  const { origin, local, width, height } = normalizePoints(points);
  return {
    ...base(style),
    type: "freedraw",
    x: origin[0],
    y: origin[1],
    width,
    height,
    points: local,
    pressures: local.map(() => 0.5),
  };
};

export const text = (
  x: number,
  y: number,
  value: string,
  style: TextStyle = {},
): LakarElement => {
  const fontSize = style.size ?? 16;
  const fontFamily = style.font ?? "hand";
  const lineHeight = 1.25;
  const metrics = measureText(value, fontFamily, fontSize, lineHeight);
  return {
    ...base(style),
    type: "text",
    x,
    y,
    width: metrics.width,
    height: metrics.height,
    text: value,
    fontSize,
    fontFamily,
    textAlign: style.align ?? "left",
    lineHeight,
    containerId: null,
    originalText: value,
    strokeColor: style.stroke ?? INK_SOFT,
    backgroundColor: "transparent",
  };
};

export const centeredText = (
  cx: number,
  cy: number,
  value: string,
  style: TextStyle = {},
): LakarElement => {
  const el = text(0, 0, value, { ...style, align: "center" });
  el.x = cx - el.width / 2;
  el.y = cy - el.height / 2;
  return el;
};

export const label = (
  container: LakarElement,
  value: string,
  style: TextStyle = {},
): LakarElement => {
  const el = text(0, 0, value, { ...style, align: "center" }) as TextElement;
  el.containerId = container.id;
  el.angle = container.angle;
  el.x = container.x + container.width / 2 - el.width / 2;
  el.y = container.y + container.height / 2 - el.height / 2;
  return el;
};

export const arcPoints = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fromDeg: number,
  toDeg: number,
  steps = 16,
): [number, number][] => {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const rad = (t * Math.PI) / 180;
    points.push([cx + rx * Math.cos(rad), cy + ry * Math.sin(rad)]);
  }
  return points;
};

export const starPoints = (
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  spikes = 5,
  rotation = -90,
): [number, number][] => {
  const points: [number, number][] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const rad = ((rotation + (i * 180) / spikes) * Math.PI) / 180;
    points.push([cx + r * Math.cos(rad), cy + r * Math.sin(rad)]);
  }
  points.push(points[0]);
  return points;
};

export const polygonPoints = (
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation = -90,
): [number, number][] => {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const rad = ((rotation + (i * 360) / sides) * Math.PI) / 180;
    points.push([cx + r * Math.cos(rad), cy + r * Math.sin(rad)]);
  }
  points.push(points[0]);
  return points;
};
