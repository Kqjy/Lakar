import type { ItemDefaults, ToolType } from "./types";

export const APP_NAME = "Lakar";

export const STROKE_COLORS = [
  "#26241f",
  "#c94040",
  "#3a7d44",
  "#3563c9",
  "#c77b1e",
] as const;

export const STROKE_SHADES = [
  "#26241f", "#495057", "#868e96", "#c94040", "#a61e1e",
  "#e8590c", "#c77b1e", "#3a7d44", "#2b8a3e", "#0d8f85",
  "#1f7a99", "#3563c9", "#364fc7", "#7048e8", "#9c36b5",
  "#c2255c", "#846358", "#5f3dc4", "#1864ab", "#087f5b",
] as const;

export const BACKGROUND_COLORS = [
  "transparent",
  "#f6caca",
  "#cbe5ce",
  "#c6daf3",
  "#f5e3af",
] as const;

export const BACKGROUND_SHADES = [
  "transparent", "#f6caca", "#f1b3b3", "#fcd9bd", "#f5e3af",
  "#ffec99", "#cbe5ce", "#a9d8b0", "#b2e8e2", "#c6daf3",
  "#a5c8f0", "#bac8ff", "#d0bfff", "#eebefa", "#fcc2d7",
  "#e6dcd4", "#dee2e6", "#c3fae8", "#ffe3e3", "#d8f5a2",
] as const;

export const CANVAS_BACKGROUNDS = [
  "#fffefb",
  "#ffffff",
  "#f6f7f9",
  "#f2f7fd",
  "#fdf6e8",
] as const;

export const DEFAULT_CANVAS_BG = CANVAS_BACKGROUNDS[0];

export const STROKE_WIDTHS = { thin: 1, bold: 2, extra: 4 } as const;
export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 36 } as const;
export const TEXT_LINE_HEIGHT = 1.25;

export const DEFAULT_ITEM: ItemDefaults = {
  strokeColor: STROKE_COLORS[0],
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: STROKE_WIDTHS.bold,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundEdges: false,
  fontSize: FONT_SIZES.M,
  fontFamily: "hand",
  textAlign: "left",
  startArrowhead: "none",
  endArrowhead: "arrow",
};

export const TOOL_SHORTCUTS: Record<string, ToolType> = {
  v: "selection",
  "1": "selection",
  h: "hand",
  r: "rectangle",
  "2": "rectangle",
  d: "diamond",
  "3": "diamond",
  o: "ellipse",
  "4": "ellipse",
  a: "arrow",
  "5": "arrow",
  l: "line",
  "6": "line",
  p: "freedraw",
  "7": "freedraw",
  t: "text",
  "8": "text",
  f: "frame",
  k: "laser",
  b: "bucket",
  e: "eraser",
  "0": "eraser",
};

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export const MAX_EDITABLE_POINTS = 14;

export const LOCAL_GUEST_SCENE_KEY = "lakar:guest-scene";
export const LOCAL_UI_KEY = "lakar:ui";
export const LOCAL_SESSION_KEY = "lakar:session";
export const LOCAL_PUBLISH_KEY = "lakar:published";

const DAY = 1000 * 60 * 60 * 24;

export const ROOM_RESUME_TTL = 21 * DAY;
export const TOMBSTONE_TTL = ROOM_RESUME_TTL + 2 * DAY;
export const MAX_ROOM_RESUMES = 5;
