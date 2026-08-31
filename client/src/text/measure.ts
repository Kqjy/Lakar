import type { FontFamily } from "../types";

export const FONT_FAMILY_CSS: Record<FontFamily, string> = {
  hand: '"Kalam", "Segoe Print", cursive',
  normal:
    '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  code: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
};

export const getFontString = (family: FontFamily, size: number) =>
  `${size}px ${FONT_FAMILY_CSS[family]}`;

let ctx: CanvasRenderingContext2D | null = null;
const getCtx = () => {
  if (!ctx) {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d")!;
  }
  return ctx;
};

export interface TextMetricsResult {
  width: number;
  height: number;
  lines: string[];
  lineWidths: number[];
}

export const measureText = (
  text: string,
  family: FontFamily,
  size: number,
  lineHeight: number,
): TextMetricsResult => {
  const c = getCtx();
  c.font = getFontString(family, size);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const lineWidths = lines.map((l) => c.measureText(l || " ").width);
  const width = Math.max(...lineWidths, size / 2);
  const height = Math.max(lines.length, 1) * size * lineHeight;
  return { width, height, lines, lineWidths };
};

export const wrapText = (
  text: string,
  family: FontFamily,
  size: number,
  maxWidth: number,
): string => {
  const c = getCtx();
  c.font = getFontString(family, size);
  const fits = (s: string) => c.measureText(s).width <= maxWidth;
  const breakLongWord = (word: string): string[] => {
    const parts: string[] = [];
    let rest = word;
    while (!fits(rest) && rest.length > 1) {
      let lo = 1;
      let hi = rest.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(rest.slice(0, mid))) lo = mid;
        else hi = mid - 1;
      }
      parts.push(rest.slice(0, lo));
      rest = rest.slice(lo);
    }
    parts.push(rest);
    return parts;
  };
  const out: string[] = [];
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (fits(rawLine)) {
      out.push(rawLine);
      continue;
    }
    let line = "";
    for (const word of rawLine.split(" ")) {
      const pieces = fits(word) ? [word] : breakLongWord(word);
      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (fits(candidate)) {
          line = candidate;
        } else {
          if (line) out.push(line);
          line = piece;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
};
