import {
  ACCENT_GREEN,
  ACCENT_RED,
  INK,
  INK_SOFT,
  TINT_BLUE,
  TINT_PAPER,
  arcPoints,
  centeredText,
  ellipse,
  label,
  line,
  rect,
  text,
  type SatchelDef,
} from "../builder";

const placeholderLines = (
  x: number,
  y: number,
  widths: number[],
  gap = 15,
) =>
  widths.map((w, i) =>
    line(
      [
        [x, y + i * gap],
        [x + w, y + i * gap],
      ],
      { stroke: INK_SOFT, strokeWidth: 1.2 },
    ),
  );

const crossedBox = (x: number, y: number, w: number, h: number) => [
  rect(x, y, w, h, { fill: TINT_PAPER }),
  line([
    [x, y],
    [x + w, y + h],
  ], { stroke: INK_SOFT, strokeWidth: 1.1 }),
  line([
    [x + w, y],
    [x, y + h],
  ], { stroke: INK_SOFT, strokeWidth: 1.1 }),
];

export const UI_PACK: SatchelDef[] = [
  {
    id: "ui-browser",
    name: "Browser window",
    category: "ui",
    keywords: ["web", "page", "chrome", "site", "mockup"],
    build: () => [
      rect(0, 0, 280, 190, { fill: "#ffffff", round: true }),
      rect(0, 0, 280, 32, { fill: TINT_PAPER }),
      ellipse(11, 11, 10, 10, { fill: ACCENT_RED, strokeWidth: 1 }),
      ellipse(27, 11, 10, 10, { fill: "#c77b1e", strokeWidth: 1 }),
      ellipse(43, 11, 10, 10, { fill: ACCENT_GREEN, strokeWidth: 1 }),
      rect(64, 7, 204, 18, { fill: "#ffffff", round: true, strokeWidth: 1.1 }),
      ...placeholderLines(20, 60, [180, 232, 200, 140], 22),
    ],
  },
  {
    id: "ui-app-window",
    name: "App window",
    category: "ui",
    keywords: ["desktop", "program", "titlebar", "mockup"],
    build: () => [
      rect(0, 0, 260, 176, { fill: "#ffffff", round: true }),
      rect(0, 0, 260, 30, { fill: TINT_BLUE }),
      text(12, 6, "Untitled", { size: 14, stroke: INK }),
      rect(0, 30, 74, 146, { fill: TINT_PAPER }),
      ...placeholderLines(90, 54, [140, 152, 110], 22),
    ],
  },
  {
    id: "ui-phone",
    name: "Phone frame",
    category: "ui",
    keywords: ["mobile", "ios", "android", "device", "screen"],
    build: () => [
      rect(0, 0, 140, 268, { fill: "#ffffff", round: true, strokeWidth: 2 }),
      line([
        [50, 12],
        [90, 12],
      ], { strokeWidth: 3, stroke: INK_SOFT }),
      rect(12, 28, 116, 200, { fill: TINT_PAPER, strokeWidth: 1.1 }),
      line(arcPoints(70, 248, 12, 12, 0, 360, 16), { strokeWidth: 1.3 }),
    ],
  },
  {
    id: "ui-tablet",
    name: "Tablet frame",
    category: "ui",
    keywords: ["ipad", "device", "screen", "mockup"],
    build: () => [
      rect(0, 0, 216, 168, { fill: "#ffffff", round: true, strokeWidth: 2 }),
      rect(16, 14, 184, 140, { fill: TINT_PAPER, strokeWidth: 1.1 }),
    ],
  },
  {
    id: "ui-button",
    name: "Button",
    category: "ui",
    keywords: ["cta", "action", "click", "submit"],
    build: () => {
      const btn = rect(0, 0, 116, 40, { fill: TINT_BLUE, round: true });
      return [btn, label(btn, "Continue", { size: 15, stroke: INK })];
    },
  },
  {
    id: "ui-input",
    name: "Text field",
    category: "ui",
    keywords: ["input", "form", "entry", "textbox"],
    build: () => [
      text(0, 0, "Email", { size: 13, stroke: INK_SOFT }),
      rect(0, 22, 180, 38, { fill: "#ffffff", round: true }),
      line([
        [14, 33],
        [14, 49],
      ], { strokeWidth: 1.4 }),
    ],
  },
  {
    id: "ui-search",
    name: "Search field",
    category: "ui",
    keywords: ["find", "query", "magnifier", "filter"],
    build: () => [
      rect(0, 0, 196, 38, { fill: "#ffffff", round: true }),
      line(arcPoints(24, 19, 8, 8, 0, 360, 14), { strokeWidth: 1.4 }),
      line([
        [30, 25],
        [37, 32],
      ], { strokeWidth: 1.6 }),
      text(48, 10, "Search…", { size: 14, stroke: INK_SOFT }),
    ],
  },
  {
    id: "ui-checkbox",
    name: "Checkbox",
    category: "ui",
    keywords: ["tick", "todo", "option", "form"],
    build: () => [
      rect(0, 0, 22, 22, { fill: "#ffffff", round: true }),
      line(
        [
          [5, 12],
          [10, 17],
          [18, 5],
        ],
        { stroke: ACCENT_GREEN, strokeWidth: 2.4 },
      ),
      text(32, 1, "Done", { size: 15, stroke: INK }),
    ],
  },
  {
    id: "ui-radio",
    name: "Radio group",
    category: "ui",
    keywords: ["option", "choice", "select", "form"],
    build: () => [
      ellipse(0, 0, 20, 20, { fill: "#ffffff" }),
      ellipse(5, 5, 10, 10, { fill: INK, strokeWidth: 0.8 }),
      text(30, 0, "Yes", { size: 15, stroke: INK }),
      ellipse(0, 34, 20, 20, { fill: "#ffffff" }),
      text(30, 34, "No", { size: 15, stroke: INK }),
    ],
  },
  {
    id: "ui-toggle",
    name: "Toggle switch",
    category: "ui",
    keywords: ["switch", "on", "off", "setting"],
    build: () => [
      line(
        [
          [14, 0],
          [46, 0],
          ...arcPoints(46, 14, 14, 14, -90, 90, 12),
          [14, 28],
          ...arcPoints(14, 14, 14, 14, 90, 270, 12),
          [14, 0],
        ],
        { fill: TINT_BLUE },
      ),
      ellipse(34, 3, 22, 22, { fill: "#ffffff" }),
      text(72, 4, "On", { size: 15, stroke: INK }),
    ],
  },
  {
    id: "ui-dropdown",
    name: "Dropdown",
    category: "ui",
    keywords: ["select", "menu", "picker", "combobox"],
    build: () => [
      rect(0, 0, 176, 38, { fill: "#ffffff", round: true }),
      text(14, 10, "Choose…", { size: 14, stroke: INK_SOFT }),
      line(
        [
          [148, 15],
          [155, 23],
          [162, 15],
        ],
        { strokeWidth: 1.8 },
      ),
    ],
  },
  {
    id: "ui-slider",
    name: "Slider",
    category: "ui",
    keywords: ["range", "control", "volume", "setting"],
    build: () => [
      line([
        [0, 10],
        [180, 10],
      ], { stroke: INK_SOFT, strokeWidth: 2.4 }),
      line([
        [0, 10],
        [108, 10],
      ], { stroke: INK, strokeWidth: 2.8 }),
      ellipse(96, 0, 22, 22, { fill: "#ffffff" }),
    ],
  },
  {
    id: "ui-card",
    name: "Media card",
    category: "ui",
    keywords: ["thumbnail", "tile", "preview", "image"],
    build: () => [
      rect(0, 0, 172, 176, { fill: "#ffffff", round: true }),
      ...crossedBox(12, 12, 148, 92),
      ...placeholderLines(12, 122, [120, 148, 92], 16),
    ],
  },
  {
    id: "ui-navbar",
    name: "Nav bar",
    category: "ui",
    keywords: ["header", "menu", "top", "navigation"],
    build: () => [
      rect(0, 0, 300, 44, { fill: "#ffffff", round: true }),
      ellipse(14, 12, 20, 20, { fill: TINT_BLUE, strokeWidth: 1.1 }),
      text(46, 13, "Home", { size: 14, stroke: INK }),
      text(104, 13, "Docs", { size: 14, stroke: INK_SOFT }),
      text(158, 13, "Pricing", { size: 14, stroke: INK_SOFT }),
      rect(238, 8, 52, 28, { fill: TINT_BLUE, round: true, strokeWidth: 1.1 }),
    ],
  },
  {
    id: "ui-sidebar",
    name: "Sidebar layout",
    category: "ui",
    keywords: ["dashboard", "shell", "nav", "layout"],
    build: () => [
      rect(0, 0, 268, 180, { fill: "#ffffff", round: true }),
      rect(0, 0, 76, 180, { fill: TINT_PAPER }),
      ...placeholderLines(12, 22, [48, 52, 40, 46], 22),
      rect(92, 18, 160, 44, { fill: TINT_BLUE, round: true, strokeWidth: 1.1 }),
      ...placeholderLines(92, 84, [148, 160, 120], 20),
    ],
  },
  {
    id: "ui-modal",
    name: "Modal dialog",
    category: "ui",
    keywords: ["popup", "confirm", "alert", "overlay"],
    build: () => [
      rect(0, 0, 220, 138, { fill: "#ffffff", round: true, strokeWidth: 2 }),
      text(18, 18, "Are you sure?", { size: 17, stroke: INK }),
      ...placeholderLines(18, 56, [160, 118], 15),
      rect(96, 92, 52, 30, { fill: "#ffffff", round: true, strokeWidth: 1.2 }),
      rect(158, 92, 46, 30, { fill: TINT_BLUE, round: true, strokeWidth: 1.2 }),
    ],
  },
  {
    id: "ui-table",
    name: "Data table",
    category: "ui",
    keywords: ["grid", "rows", "columns", "list"],
    build: () => {
      const els = [
        rect(0, 0, 252, 132, { fill: "#ffffff" }),
        rect(0, 0, 252, 30, { fill: TINT_PAPER }),
      ];
      for (let i = 1; i < 4; i++) {
        els.push(
          line([
            [0, 30 + i * 26],
            [252, 30 + i * 26],
          ], { stroke: INK_SOFT, strokeWidth: 1 }),
        );
      }
      els.push(
        line([
          [92, 0],
          [92, 132],
        ], { stroke: INK_SOFT, strokeWidth: 1 }),
        line([
          [176, 0],
          [176, 132],
        ], { stroke: INK_SOFT, strokeWidth: 1 }),
      );
      return els;
    },
  },
  {
    id: "ui-avatar",
    name: "Avatar",
    category: "ui",
    keywords: ["profile", "user", "photo", "person"],
    build: () => [
      ellipse(0, 0, 56, 56, { fill: TINT_BLUE }),
      ellipse(19, 13, 18, 18, { fill: "#ffffff", strokeWidth: 1.2 }),
      line(arcPoints(28, 50, 17, 15, 180, 360, 14), { strokeWidth: 1.4 }),
    ],
  },
  {
    id: "ui-progress",
    name: "Progress bar",
    category: "ui",
    keywords: ["loading", "percent", "status", "meter"],
    build: () => [
      rect(0, 0, 190, 18, { fill: "#ffffff", round: true }),
      rect(2, 2, 116, 14, { fill: TINT_BLUE, strokeWidth: 0.8, round: true }),
      text(200, 0, "62%", { size: 14, stroke: INK_SOFT }),
    ],
  },
  {
    id: "ui-tabs",
    name: "Tab bar",
    category: "ui",
    keywords: ["tabs", "segments", "switcher", "nav"],
    build: () => {
      const bar = rect(0, 0, 228, 38, { fill: "#ffffff", round: true });
      const active = rect(4, 4, 72, 30, {
        fill: TINT_BLUE,
        round: true,
        strokeWidth: 1,
      });
      return [
        bar,
        active,
        label(active, "One", { size: 13, stroke: INK }),
        centeredText(114, 19, "Two", { size: 13, stroke: INK_SOFT }),
        centeredText(190, 19, "Three", { size: 13, stroke: INK_SOFT }),
      ];
    },
  },
  {
    id: "ui-cursor",
    name: "Pointer",
    category: "ui",
    keywords: ["mouse", "cursor", "click", "arrow"],
    build: () => [
      line(
        [
          [0, 0],
          [30, 24],
          [16, 26],
          [22, 41],
          [15, 44],
          [9, 30],
          [0, 38],
          [0, 0],
        ],
        { fill: INK, fillStyle: "solid", strokeWidth: 1.4 },
      ),
    ],
  },
];
