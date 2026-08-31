import rough from "roughjs/bin/rough";
import type { Drawable, Options } from "roughjs/bin/core";
import { getStroke } from "perfect-freehand";
import type {
  Arrowhead,
  FreedrawElement,
  LinearElement,
  Theme,
  LakarElement,
} from "../types";
import { themedColor } from "../colors";

export const generator = rough.generator();

const dashArray = (style: string, w: number): number[] | undefined => {
  if (style === "dashed") return [8, 8 + w];
  if (style === "dotted") return [1.5, 6 + w];
  return undefined;
};

const baseOptions = (el: LakarElement, theme: Theme): Options => {
  const stroke = themedColor(el.strokeColor, theme);
  const opts: Options = {
    seed: el.seed,
    stroke,
    strokeWidth: el.strokeWidth,
    roughness: el.roughness,
    bowing: 1,
    strokeLineDash: dashArray(el.strokeStyle, el.strokeWidth),
    disableMultiStroke: el.strokeStyle !== "solid",
    preserveVertices: true,
  };
  if (el.backgroundColor !== "transparent") {
    opts.fill = themedColor(el.backgroundColor, theme);
    opts.fillStyle = el.fillStyle;
    opts.fillWeight = el.strokeWidth / 2;
    opts.hachureGap = Math.max(4, el.strokeWidth * 4);
    if (el.fillStyle === "solid") {

      opts.fillWeight = 0;
    }
  }
  return opts;
};

const roundedRectPath = (w: number, h: number, r: number) =>
  `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${
    w - r
  } ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;

const roundedDiamondPath = (w: number, h: number) => {
  const r = Math.min(w, h) * 0.12;
  const hx = w / 2;
  const hy = h / 2;

  const edge = Math.hypot(hx, hy);
  const t = Math.min(0.5, r / edge);
  const lerp = (a: [number, number], b: [number, number], f: number): [number, number] => [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
  ];
  const T: [number, number] = [hx, 0];
  const R: [number, number] = [w, hy];
  const B: [number, number] = [hx, h];
  const L: [number, number] = [0, hy];
  const verts: [number, number][] = [T, R, B, L];
  let d = "";
  for (let i = 0; i < 4; i++) {
    const prev = verts[(i + 3) % 4];
    const v = verts[i];
    const next = verts[(i + 1) % 4];
    const p1 = lerp(v, prev, t);
    const p2 = lerp(v, next, t);
    d += (i === 0 ? `M ${p1[0]} ${p1[1]} ` : `L ${p1[0]} ${p1[1]} `) +
      `Q ${v[0]} ${v[1]} ${p2[0]} ${p2[1]} `;
  }
  return d + "Z";
};

export interface ElementShape {
  drawables: Drawable[];
  
  freedrawPath?: Path2D;
  freedrawD?: string;
}

interface CacheEntry {
  version: number;
  theme: Theme;
  shape: ElementShape;
}

const cache = new Map<string, CacheEntry>();

export const invalidateShape = (id: string) => cache.delete(id);
export const clearShapeCache = () => cache.clear();

const arrowheadDrawables = (
  el: LinearElement,
  which: "start" | "end",
  kind: Arrowhead,
  opts: Options,
): Drawable[] => {
  if (kind === "none" || el.points.length < 2) return [];
  const pts = el.points;
  const tip = which === "end" ? pts[pts.length - 1] : pts[0];
  const prev = which === "end" ? pts[pts.length - 2] : pts[1];
  let dx = tip[0] - prev[0];
  let dy = tip[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const size = Math.min(30, 12 + el.strokeWidth * 3);
  const ang = Math.PI / 7.5;
  const o: Options = { ...opts, strokeLineDash: undefined, disableMultiStroke: true };
  if (kind === "arrow") {
    const mk = (rot: number) => {
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const bx = tip[0] - size * (dx * cos - dy * sin);
      const by = tip[1] - size * (dx * sin + dy * cos);
      return generator.line(tip[0], tip[1], bx, by, o);
    };
    return [mk(ang), mk(-ang)];
  }
  if (kind === "bar") {
    const half = size / 2;
    return [
      generator.line(
        tip[0] - dy * half,
        tip[1] + dx * half,
        tip[0] + dy * half,
        tip[1] - dx * half,
        o,
      ),
    ];
  }

  const r = 4 + el.strokeWidth;
  return [
    generator.ellipse(tip[0], tip[1], r * 2, r * 2, {
      ...o,
      fill: o.stroke,
      fillStyle: "solid",
    }),
  ];
};

export const getFreedrawOutline = (el: FreedrawElement): string => {
  const inputPoints = el.points.map(([x, y], i) => [
    x,
    y,
    el.pressures[i] ?? 0.5,
  ]);
  const hasPressure = el.pressures.some((p) => p !== 0.5);
  const outline = getStroke(inputPoints, {
    size: el.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    simulatePressure: !hasPressure,
    last: true,
  });
  if (!outline.length) return "";
  const med = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)} Q`;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const next = outline[(i + 1) % outline.length];
    const m = med(p, next);
    d += ` ${p[0].toFixed(2)} ${p[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`;
  }
  return d + " Z";
};

export const getElementShape = (
  el: LakarElement,
  theme: Theme,
): ElementShape => {
  const hit = cache.get(el.id);
  if (hit && hit.version === el.version && hit.theme === theme) return hit.shape;

  const opts = baseOptions(el, theme);
  let shape: ElementShape;

  switch (el.type) {
    case "rectangle": {
      const w = Math.abs(el.width);
      const h = Math.abs(el.height);
      if (el.roundEdges && w > 2 && h > 2) {
        const r = Math.min(32, Math.min(w, h) * 0.25);
        shape = { drawables: [generator.path(roundedRectPath(w, h, r), opts)] };
      } else {
        shape = { drawables: [generator.rectangle(0, 0, w, h, opts)] };
      }
      break;
    }
    case "diamond": {
      const w = Math.abs(el.width);
      const h = Math.abs(el.height);
      if (el.roundEdges && w > 2 && h > 2) {
        shape = { drawables: [generator.path(roundedDiamondPath(w, h), opts)] };
      } else {
        shape = {
          drawables: [
            generator.polygon(
              [
                [w / 2, 0],
                [w, h / 2],
                [w / 2, h],
                [0, h / 2],
              ],
              opts,
            ),
          ],
        };
      }
      break;
    }
    case "ellipse": {
      const w = Math.abs(el.width);
      const h = Math.abs(el.height);
      shape = {
        drawables: [
          generator.ellipse(w / 2, h / 2, w, h, {
            ...opts,
            curveFitting: 1,
          }),
        ],
      };
      break;
    }
    case "line":
    case "arrow": {
      const pts = el.points;
      const drawables: Drawable[] = [];
      if (pts.length >= 2) {

        if (
          el.type === "line" &&
          el.backgroundColor !== "transparent" &&
          pts.length > 2
        ) {
          drawables.push(generator.polygon(pts as [number, number][], opts));
        } else if (el.roundEdges && pts.length > 2) {
          drawables.push(generator.curve(pts as [number, number][], opts));
        } else {
          drawables.push(generator.linearPath(pts as [number, number][], opts));
        }
      }
      if (el.type === "arrow") {
        drawables.push(...arrowheadDrawables(el, "start", el.startArrowhead, opts));
        drawables.push(...arrowheadDrawables(el, "end", el.endArrowhead, opts));
      }
      shape = { drawables };
      break;
    }
    case "freedraw": {
      const d = getFreedrawOutline(el);
      shape = {
        drawables: [],
        freedrawPath: d ? new Path2D(d) : undefined,
        freedrawD: d,
      };
      break;
    }
    case "text":
    case "image":
    case "frame":
      shape = { drawables: [] };
      break;
  }

  cache.set(el.id, { version: el.version, theme, shape });
  return shape;
};
