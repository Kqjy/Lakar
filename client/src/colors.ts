import type { Theme } from "./types";

const cache = new Map<string, string>();

const parseColor = (color: string): [number, number, number, number] | null => {
  if (color === "transparent") return null;
  let hex = color.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((c) => c + c).join("");
  }
  if (hex.length === 6) hex += "ff";
  if (hex.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
};

const hueRotateMatrix = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];
};

const M = hueRotateMatrix(180);
const INVERT = 0.93;

export const darkVariant = (color: string): string => {
  const hit = cache.get(color);
  if (hit) return hit;
  const parsed = parseColor(color);
  if (!parsed) return color;
  let [r, g, b] = parsed;
  const a = parsed[3];

  r = r + (255 - 2 * r) * INVERT;
  g = g + (255 - 2 * g) * INVERT;
  b = b + (255 - 2 * b) * INVERT;

  const r2 = Math.round(Math.min(255, Math.max(0, M[0] * r + M[1] * g + M[2] * b)));
  const g2 = Math.round(Math.min(255, Math.max(0, M[3] * r + M[4] * g + M[5] * b)));
  const b2 = Math.round(Math.min(255, Math.max(0, M[6] * r + M[7] * g + M[8] * b)));
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  const out =
    a === 255
      ? `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`
      : `#${toHex(r2)}${toHex(g2)}${toHex(b2)}${toHex(a)}`;
  cache.set(color, out);
  return out;
};

export const themedColor = (color: string, theme: Theme): string =>
  theme === "dark" ? darkVariant(color) : color;

export type HSV = { h: number; s: number; v: number };

export const hexToHsv = (color: string): HSV | null => {
  const parsed = parseColor(color);
  if (!parsed) return null;
  const [r, g, b] = parsed.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
};

export const hsvToHex = ({ h, s, v }: HSV): string => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
};
