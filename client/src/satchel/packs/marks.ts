import type { LakarElement } from "../../types";
import {
  ACCENT_AMBER,
  ACCENT_GREEN,
  ACCENT_RED,
  INK,
  INK_SOFT,
  TINT_SAND,
  arcPoints,
  centeredText,
  ellipse,
  ink,
  label,
  line,
  rect,
  starPoints,
  text,
  type SatchelDef,
} from "../builder";

const bracePoints = (
  x: number,
  y: number,
  h: number,
  depth: number,
  flip = false,
): [number, number][] => {
  const d = flip ? -depth : depth;
  const mid = y + h / 2;
  return [
    [x, y],
    [x - d * 0.7, y + h * 0.06],
    [x - d * 0.9, y + h * 0.2],
    [x - d * 0.95, mid - h * 0.09],
    [x - d * 1.7, mid],
    [x - d * 0.95, mid + h * 0.09],
    [x - d * 0.9, y + h * 0.8],
    [x - d * 0.7, y + h * 0.94],
    [x, y + h],
  ];
};

const squigglePoints = (
  x: number,
  y: number,
  w: number,
  amp: number,
  waves = 4,
): [number, number][] => {
  const pts: [number, number][] = [];
  const steps = waves * 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x + w * t, y + Math.sin(t * Math.PI * 2 * waves) * amp]);
  }
  return pts;
};

export const MARKS_PACK: SatchelDef[] = [
  {
    id: "mark-speech",
    name: "Speech bubble",
    category: "annotate",
    keywords: ["say", "comment", "talk", "quote", "chat"],
    build: () => [
      line(
        [
          [16, 0],
          [154, 0],
          ...arcPoints(154, 16, 16, 16, -90, 0, 6),
          [170, 68],
          ...arcPoints(154, 68, 16, 16, 0, 90, 6),
          [64, 84],
          [40, 110],
          [42, 84],
          [16, 84],
          ...arcPoints(16, 68, 16, 16, 90, 180, 6),
          [0, 16],
          ...arcPoints(16, 16, 16, 16, 180, 270, 6),
        ],
        { fill: "#ffffff" },
      ),
      centeredText(85, 42, "Say it", { size: 16, stroke: INK }),
    ],
  },
  {
    id: "mark-thought",
    name: "Thought bubble",
    category: "annotate",
    keywords: ["think", "idea", "wonder", "cloud", "maybe"],
    build: () => [
      ellipse(20, 0, 132, 76, { fill: "#ffffff" }),
      ellipse(4, 42, 40, 34, { fill: "#ffffff" }),
      ellipse(30, 62, 32, 30, { fill: "#ffffff" }),
      ellipse(18, 92, 20, 18, { fill: "#ffffff" }),
      ellipse(2, 116, 12, 12, { fill: "#ffffff" }),
    ],
  },
  {
    id: "mark-burst",
    name: "Shout burst",
    category: "annotate",
    keywords: ["new", "star", "explode", "badge", "attention"],
    build: () => [
      line(starPoints(60, 60, 60, 38, 12), { fill: TINT_SAND }),
      centeredText(60, 60, "New!", { size: 16, stroke: ACCENT_RED }),
    ],
  },
  {
    id: "mark-banner",
    name: "Banner ribbon",
    category: "annotate",
    keywords: ["title", "header", "label", "award", "ribbon"],
    build: () => [
      line(
        [
          [0, 0],
          [200, 0],
          [200, 48],
          [0, 48],
          [0, 0],
        ],
        { fill: ACCENT_RED, fillStyle: "solid" },
      ),
      line(
        [
          [0, 0],
          [-24, 12],
          [0, 24],
        ],
        { fill: ACCENT_RED, fillStyle: "solid", strokeWidth: 1.2 },
      ),
      line(
        [
          [200, 0],
          [224, 12],
          [200, 24],
        ],
        { fill: ACCENT_RED, fillStyle: "solid", strokeWidth: 1.2 },
      ),
      centeredText(100, 24, "Headline", { size: 18, stroke: "#ffffff" }),
    ],
  },
  {
    id: "mark-tag",
    name: "Tag",
    category: "annotate",
    keywords: ["label", "chip", "category", "badge"],
    build: () => [
      line(
        [
          [0, 0],
          [92, 0],
          [116, 22],
          [92, 44],
          [0, 44],
          [0, 0],
        ],
        { fill: TINT_SAND },
      ),
      ellipse(84, 17, 11, 11, { fill: "#ffffff", strokeWidth: 1.1 }),
      text(14, 12, "label", { size: 15, stroke: INK }),
    ],
  },
  {
    id: "mark-pin",
    name: "Map pin",
    category: "annotate",
    keywords: ["location", "place", "here", "marker", "point"],
    build: () => [
      line(
        [
          ...arcPoints(30, 30, 30, 30, 150, 390, 20),
          [30, 88],
          [8.5, 45],
        ],
        { fill: ACCENT_RED, fillStyle: "solid" },
      ),
      ellipse(19, 19, 22, 22, { fill: "#ffffff", strokeWidth: 1.2 }),
    ],
  },
  {
    id: "mark-brace-left",
    name: "Curly brace",
    category: "annotate",
    keywords: ["bracket", "group", "span", "range"],
    build: () => [
      line(bracePoints(24, 0, 140, 14), { round: true, strokeWidth: 1.8 }),
    ],
  },
  {
    id: "mark-brace-top",
    name: "Brace with label",
    category: "annotate",
    keywords: ["bracket", "annotation", "explain", "group"],
    build: () => [
      line(bracePoints(24, 0, 140, 14), { round: true, strokeWidth: 1.8 }),
      text(42, 58, "these three", { size: 15, stroke: INK_SOFT }),
    ],
  },
  {
    id: "mark-underline",
    name: "Squiggle underline",
    category: "annotate",
    keywords: ["emphasis", "wavy", "highlight", "stress"],
    build: () => [
      ink(squigglePoints(0, 8, 168, 5, 5), {
        stroke: ACCENT_RED,
        strokeWidth: 1.6,
      }),
    ],
  },
  {
    id: "mark-circle",
    name: "Circle it",
    category: "annotate",
    keywords: ["highlight", "ring", "emphasis", "loop", "around"],
    build: () => [
      ink(
        [
          ...arcPoints(80, 46, 78, 44, 20, 380, 34),
          ...arcPoints(80, 46, 76, 42, 20, 120, 10),
        ],
        { stroke: ACCENT_RED, strokeWidth: 1.4 },
      ),
    ],
  },
  {
    id: "mark-strike",
    name: "Cross out",
    category: "annotate",
    keywords: ["delete", "wrong", "reject", "no", "cancel"],
    build: () => [
      ink(
        [
          [0, 4],
          [46, 22],
          [96, 38],
          [140, 58],
        ],
        { stroke: ACCENT_RED, strokeWidth: 2 },
      ),
      ink(
        [
          [138, 0],
          [92, 20],
          [44, 38],
          [2, 60],
        ],
        { stroke: ACCENT_RED, strokeWidth: 2 },
      ),
    ],
  },
  {
    id: "mark-check-stamp",
    name: "Approved stamp",
    category: "annotate",
    keywords: ["done", "ok", "yes", "approved", "tick"],
    build: () => {
      const frame = rect(0, 0, 148, 56, {
        stroke: ACCENT_GREEN,
        strokeWidth: 2.4,
        round: true,
        angle: -0.12,
      });
      return [
        frame,
        label(frame, "APPROVED", { size: 17, stroke: ACCENT_GREEN }),
      ];
    },
  },
  {
    id: "mark-todo",
    name: "Checklist",
    category: "annotate",
    keywords: ["tasks", "list", "todo", "steps", "done"],
    build: () => {
      const els: LakarElement[] = [];
      for (let i = 0; i < 3; i++) {
        const y = i * 34;
        els.push(rect(0, y, 22, 22, { fill: "#ffffff", strokeWidth: 1.3 }));
        els.push(
          line([
            [34, y + 11],
            [140, y + 11],
          ], { stroke: INK_SOFT, strokeWidth: 1.2 }),
        );
      }
      els.push(
        line(
          [
            [5, 12],
            [10, 17],
            [18, 4],
          ],
          { stroke: ACCENT_GREEN, strokeWidth: 2.4 },
        ),
      );
      return els;
    },
  },
  {
    id: "mark-numbered",
    name: "Numbered step",
    category: "annotate",
    keywords: ["order", "sequence", "badge", "count", "step"],
    build: () => {
      const disc = ellipse(0, 0, 44, 44, {
        fill: ACCENT_AMBER,
        fillStyle: "solid",
      });
      return [disc, label(disc, "1", { size: 20, stroke: "#ffffff" })];
    },
  },
  {
    id: "mark-arrow-doodle",
    name: "Hand arrow",
    category: "annotate",
    keywords: ["point", "doodle", "sketch", "look here"],
    build: () => [
      ink(
        [
          [0, 74],
          [18, 46],
          [46, 24],
          [82, 12],
          [116, 10],
        ],
        { strokeWidth: 1.8 },
      ),
      ink(
        [
          [92, 0],
          [118, 10],
          [96, 26],
        ],
        { strokeWidth: 1.8 },
      ),
    ],
  },
];
