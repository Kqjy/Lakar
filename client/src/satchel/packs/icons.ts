import type { LakarElement } from "../../types";
import {
  ACCENT_AMBER,
  ACCENT_BLUE,
  ACCENT_GREEN,
  ACCENT_RED,
  INK,
  INK_SOFT,
  TINT_BLUE,
  TINT_SAND,
  arcPoints,
  centeredText,
  ellipse,
  label,
  line,
  polygonPoints,
  rect,
  starPoints,
  type SatchelDef,
} from "../builder";

const ICON = 56;

const heartPoints = (
  cx: number,
  cy: number,
  scale: number,
): [number, number][] => {
  const pts: [number, number][] = [];
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    pts.push([cx + x * scale, cy - y * scale]);
  }
  return pts;
};

export const ICON_PACK: SatchelDef[] = [
  {
    id: "icon-star",
    name: "Star",
    category: "icons",
    keywords: ["favourite", "rating", "important", "bookmark"],
    build: () => [
      line(starPoints(28, 28, 28, 12, 5), {
        fill: ACCENT_AMBER,
        fillStyle: "solid",
        strokeWidth: 1.3,
      }),
    ],
  },
  {
    id: "icon-heart",
    name: "Heart",
    category: "icons",
    keywords: ["love", "like", "favourite", "care"],
    build: () => [
      line(heartPoints(28, 26, 1.7), {
        fill: ACCENT_RED,
        fillStyle: "solid",
        strokeWidth: 1.3,
        roughness: 0.6,
      }),
    ],
  },
  {
    id: "icon-check",
    name: "Check",
    category: "icons",
    keywords: ["tick", "done", "yes", "ok", "complete"],
    build: () => [
      line(
        [
          [2, 26],
          [20, 46],
          [54, 4],
        ],
        { stroke: ACCENT_GREEN, strokeWidth: 4, round: true },
      ),
    ],
  },
  {
    id: "icon-cross",
    name: "Cross",
    category: "icons",
    keywords: ["no", "close", "wrong", "delete", "x"],
    build: () => [
      line(
        [
          [4, 4],
          [48, 48],
        ],
        { stroke: ACCENT_RED, strokeWidth: 4 },
      ),
      line(
        [
          [48, 4],
          [4, 48],
        ],
        { stroke: ACCENT_RED, strokeWidth: 4 },
      ),
    ],
  },
  {
    id: "icon-warning",
    name: "Warning",
    category: "icons",
    keywords: ["alert", "caution", "danger", "risk", "attention"],
    build: () => [
      line(
        [
          [28, 0],
          [56, 50],
          [0, 50],
          [28, 0],
        ],
        { fill: TINT_SAND, round: true },
      ),
      line(
        [
          [28, 18],
          [28, 34],
        ],
        { strokeWidth: 3, stroke: ACCENT_RED },
      ),
      ellipse(25, 39, 6, 6, { fill: ACCENT_RED, fillStyle: "solid", strokeWidth: 0.8 }),
    ],
  },
  {
    id: "icon-bulb",
    name: "Lightbulb",
    category: "icons",
    keywords: ["idea", "insight", "think", "bright", "eureka"],
    build: () => [
      line(
        [
          ...arcPoints(24, 22, 20, 20, 210, 330, 16),
          [32, 44],
          [16, 44],
          [10.6, 32],
        ],
        { fill: TINT_SAND },
      ),
      rect(16, 44, 16, 8, { fill: "#ffffff", strokeWidth: 1.2 }),
      line(
        [
          [18, 56],
          [30, 56],
        ],
        { strokeWidth: 1.6 },
      ),
      line(
        [
          [24, 2],
          [24, 10],
        ],
        { strokeWidth: 1.4, stroke: ACCENT_AMBER },
      ),
      line(
        [
          [46, 12],
          [52, 8],
        ],
        { strokeWidth: 1.4, stroke: ACCENT_AMBER },
      ),
      line(
        [
          [2, 12],
          [-4, 8],
        ],
        { strokeWidth: 1.4, stroke: ACCENT_AMBER },
      ),
    ],
  },
  {
    id: "icon-search",
    name: "Magnifier",
    category: "icons",
    keywords: ["search", "find", "look", "zoom", "inspect"],
    build: () => [
      ellipse(0, 0, 38, 38, { fill: "#ffffff", strokeWidth: 2.2 }),
      line(
        [
          [33, 33],
          [54, 54],
        ],
        { strokeWidth: 3.4, round: true },
      ),
    ],
  },
  {
    id: "icon-lock",
    name: "Lock",
    category: "icons",
    keywords: ["secure", "private", "closed", "password", "encrypted"],
    build: () => [
      rect(0, 22, 44, 34, { fill: TINT_BLUE, round: true }),
      line(arcPoints(22, 22, 14, 17, 180, 360, 14), { strokeWidth: 2.4 }),
      ellipse(18, 34, 8, 8, { fill: INK, fillStyle: "solid", strokeWidth: 0.8 }),
    ],
  },
  {
    id: "icon-key",
    name: "Key",
    category: "icons",
    keywords: ["access", "unlock", "secret", "credential"],
    build: () => [
      ellipse(0, 8, 28, 28, { fill: "#ffffff", strokeWidth: 2 }),
      line(
        [
          [26, 22],
          [58, 22],
        ],
        { strokeWidth: 2.4 },
      ),
      line(
        [
          [46, 22],
          [46, 32],
        ],
        { strokeWidth: 2.4 },
      ),
      line(
        [
          [56, 22],
          [56, 34],
        ],
        { strokeWidth: 2.4 },
      ),
    ],
  },
  {
    id: "icon-clock",
    name: "Clock",
    category: "icons",
    keywords: ["time", "schedule", "deadline", "wait", "when"],
    build: () => [
      ellipse(0, 0, ICON, ICON, { fill: "#ffffff", strokeWidth: 2 }),
      line(
        [
          [28, 28],
          [28, 12],
        ],
        { strokeWidth: 2.2 },
      ),
      line(
        [
          [28, 28],
          [40, 34],
        ],
        { strokeWidth: 2.2 },
      ),
    ],
  },
  {
    id: "icon-calendar",
    name: "Calendar",
    category: "icons",
    keywords: ["date", "schedule", "month", "plan", "event"],
    build: () => {
      const els = [
        rect(0, 6, 56, 50, { fill: "#ffffff", round: true }),
        line([
          [0, 20],
          [56, 20],
        ], { strokeWidth: 1.4 }),
        line([
          [14, 0],
          [14, 12],
        ], { strokeWidth: 2.2 }),
        line([
          [42, 0],
          [42, 12],
        ], { strokeWidth: 2.2 }),
      ];
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          els.push(
            rect(9 + c * 14, 27 + r * 14, 8, 8, {
              fill: INK_SOFT,
              fillStyle: "solid",
              strokeWidth: 0.6,
              stroke: INK_SOFT,
            }),
          );
        }
      }
      return els;
    },
  },
  {
    id: "icon-flag",
    name: "Flag",
    category: "icons",
    keywords: ["milestone", "goal", "mark", "target", "start"],
    build: () => [
      line(
        [
          [0, 0],
          [0, 60],
        ],
        { strokeWidth: 2.4 },
      ),
      line(
        [
          [0, 2],
          [40, 10],
          [40, 32],
          [0, 24],
          [0, 2],
        ],
        { fill: ACCENT_RED, fillStyle: "solid", strokeWidth: 1.2 },
      ),
    ],
  },
  {
    id: "icon-gear",
    name: "Gear",
    category: "icons",
    keywords: ["settings", "config", "options", "engine", "system"],
    build: () => {
      const els: LakarElement[] = [];
      const cx = 30;
      const cy = 30;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const px = cx + Math.cos(angle) * 26;
        const py = cy + Math.sin(angle) * 26;
        els.push(
          rect(px - 7, py - 5, 14, 10, {
            fill: INK_SOFT,
            fillStyle: "solid",
            stroke: INK,
            strokeWidth: 1,
            angle,
          }),
        );
      }
      els.push(ellipse(8, 8, 44, 44, { fill: "#ffffff", strokeWidth: 2 }));
      els.push(ellipse(21, 21, 18, 18, { fill: "#ffffff", strokeWidth: 1.6 }));
      return els;
    },
  },
  {
    id: "icon-folder",
    name: "Folder",
    category: "icons",
    keywords: ["directory", "files", "group", "storage"],
    build: () => [
      line(
        [
          [0, 8],
          [22, 8],
          [30, 18],
          [60, 18],
          [60, 52],
          [0, 52],
          [0, 8],
        ],
        { fill: TINT_SAND },
      ),
    ],
  },
  {
    id: "icon-file",
    name: "File",
    category: "icons",
    keywords: ["document", "page", "text", "attachment"],
    build: () => [
      line(
        [
          [0, 0],
          [30, 0],
          [46, 16],
          [46, 60],
          [0, 60],
          [0, 0],
        ],
        { fill: "#ffffff" },
      ),
      line(
        [
          [30, 0],
          [30, 16],
          [46, 16],
        ],
        { strokeWidth: 1.3 },
      ),
      line(
        [
          [10, 30],
          [36, 30],
        ],
        { stroke: INK_SOFT, strokeWidth: 1.2 },
      ),
      line(
        [
          [10, 42],
          [36, 42],
        ],
        { stroke: INK_SOFT, strokeWidth: 1.2 },
      ),
    ],
  },
  {
    id: "icon-mail",
    name: "Mail",
    category: "icons",
    keywords: ["email", "message", "envelope", "send", "inbox"],
    build: () => [
      rect(0, 0, 62, 44, { fill: "#ffffff", strokeWidth: 1.8 }),
      line(
        [
          [0, 0],
          [31, 26],
          [62, 0],
        ],
        { strokeWidth: 1.6 },
      ),
    ],
  },
  {
    id: "icon-chat",
    name: "Chat",
    category: "icons",
    keywords: ["message", "comment", "discuss", "reply", "talk"],
    build: () => [
      rect(0, 0, 58, 42, { fill: TINT_BLUE, round: true }),
      line(
        [
          [14, 42],
          [12, 58],
          [30, 42],
        ],
        { fill: TINT_BLUE, strokeWidth: 1.3 },
      ),
      ellipse(14, 18, 6, 6, { fill: INK, fillStyle: "solid", strokeWidth: 0.6 }),
      ellipse(26, 18, 6, 6, { fill: INK, fillStyle: "solid", strokeWidth: 0.6 }),
      ellipse(38, 18, 6, 6, { fill: INK, fillStyle: "solid", strokeWidth: 0.6 }),
    ],
  },
  {
    id: "icon-bell",
    name: "Bell",
    category: "icons",
    keywords: ["notification", "alert", "remind", "ping"],
    build: () => [
      line(
        [
          [4, 44],
          [8, 22],
          ...arcPoints(26, 22, 18, 18, 180, 360, 14),
          [48, 44],
          [4, 44],
        ],
        { fill: TINT_SAND },
      ),
      line(
        [
          [26, 0],
          [26, 5],
        ],
        { strokeWidth: 2 },
      ),
      line(arcPoints(26, 46, 8, 7, 0, 180, 10), { strokeWidth: 1.6 }),
    ],
  },
  {
    id: "icon-eye",
    name: "Eye",
    category: "icons",
    keywords: ["view", "watch", "visible", "observe", "preview"],
    build: () => [
      line(
        [
          ...arcPoints(30, 22, 30, 20, 0, 180, 16),
          ...arcPoints(30, 22, 30, 20, 180, 360, 16),
        ],
        { fill: "#ffffff", strokeWidth: 1.8 },
      ),
      ellipse(20, 12, 20, 20, { fill: ACCENT_BLUE, strokeWidth: 1.2 }),
    ],
  },
  {
    id: "icon-trash",
    name: "Trash",
    category: "icons",
    keywords: ["delete", "remove", "bin", "discard"],
    build: () => [
      line(
        [
          [4, 12],
          [10, 56],
          [38, 56],
          [44, 12],
        ],
        { fill: "#ffffff", strokeWidth: 1.8 },
      ),
      line(
        [
          [0, 12],
          [48, 12],
        ],
        { strokeWidth: 2.2 },
      ),
      line(
        [
          [17, 4],
          [31, 4],
        ],
        { strokeWidth: 2.2 },
      ),
      line(
        [
          [18, 22],
          [20, 46],
        ],
        { stroke: INK_SOFT, strokeWidth: 1.2 },
      ),
      line(
        [
          [30, 22],
          [28, 46],
        ],
        { stroke: INK_SOFT, strokeWidth: 1.2 },
      ),
    ],
  },
  {
    id: "icon-upload",
    name: "Upload",
    category: "icons",
    keywords: ["send", "sync", "push", "cloud", "backup"],
    build: () => [
      line(
        [
          [8, 46],
          ...arcPoints(14, 34, 14, 12, 90, 250, 8),
          ...arcPoints(32, 22, 18, 18, 190, 340, 10),
          ...arcPoints(52, 34, 13, 12, 290, 450, 8),
          [8, 46],
        ],
        { fill: "#ffffff" },
      ),
      line(
        [
          [32, 56],
          [32, 30],
        ],
        { strokeWidth: 2.2, stroke: ACCENT_BLUE },
      ),
      line(
        [
          [24, 38],
          [32, 30],
          [40, 38],
        ],
        { strokeWidth: 2.2, stroke: ACCENT_BLUE },
      ),
    ],
  },
  {
    id: "icon-wifi",
    name: "Signal",
    category: "icons",
    keywords: ["wifi", "network", "connection", "online", "wireless"],
    build: () => [
      line(arcPoints(30, 44, 30, 26, 200, 340, 14), { strokeWidth: 2.4 }),
      line(arcPoints(30, 44, 20, 17, 200, 340, 12), { strokeWidth: 2.4 }),
      line(arcPoints(30, 44, 10, 9, 200, 340, 10), { strokeWidth: 2.4 }),
      ellipse(26, 40, 8, 8, { fill: INK, fillStyle: "solid", strokeWidth: 0.8 }),
    ],
  },
  {
    id: "icon-battery",
    name: "Battery",
    category: "icons",
    keywords: ["power", "charge", "energy", "level"],
    build: () => [
      rect(0, 0, 62, 32, { fill: "#ffffff", round: true }),
      rect(62, 10, 7, 12, { fill: INK, fillStyle: "solid", strokeWidth: 1 }),
      rect(5, 5, 34, 22, { fill: ACCENT_GREEN, fillStyle: "solid", strokeWidth: 0.8 }),
    ],
  },
  {
    id: "icon-play",
    name: "Play",
    category: "icons",
    keywords: ["start", "run", "go", "video", "trigger"],
    build: () => [
      line(polygonPoints(28, 28, 30, 3, 0), {
        fill: ACCENT_GREEN,
        fillStyle: "solid",
      }),
    ],
  },
  {
    id: "icon-plus",
    name: "Plus",
    category: "icons",
    keywords: ["add", "new", "create", "more"],
    build: () => [
      line(
        [
          [28, 2],
          [28, 54],
        ],
        { strokeWidth: 4 },
      ),
      line(
        [
          [2, 28],
          [54, 28],
        ],
        { strokeWidth: 4 },
      ),
    ],
  },
  {
    id: "icon-target",
    name: "Target",
    category: "icons",
    keywords: ["goal", "aim", "focus", "objective", "bullseye"],
    build: () => [
      ellipse(0, 0, 60, 60, { fill: "#ffffff", strokeWidth: 2 }),
      ellipse(11, 11, 38, 38, { strokeWidth: 1.6 }),
      ellipse(22, 22, 16, 16, {
        fill: ACCENT_RED,
        fillStyle: "solid",
        strokeWidth: 1.2,
      }),
    ],
  },
  {
    id: "icon-rocket",
    name: "Rocket",
    category: "icons",
    keywords: ["launch", "ship", "release", "fast", "startup"],
    build: () => [
      line(
        [
          [24, 0],
          [38, 24],
          [38, 56],
          [10, 56],
          [10, 24],
          [24, 0],
        ],
        { fill: "#ffffff" },
      ),
      line(
        [
          [10, 34],
          [0, 54],
          [10, 50],
        ],
        { fill: ACCENT_RED, fillStyle: "solid", strokeWidth: 1.2 },
      ),
      line(
        [
          [38, 34],
          [48, 54],
          [38, 50],
        ],
        { fill: ACCENT_RED, fillStyle: "solid", strokeWidth: 1.2 },
      ),
      ellipse(18, 20, 12, 12, { fill: TINT_BLUE, strokeWidth: 1.2 }),
      line(
        [
          [18, 58],
          [24, 74],
          [30, 58],
        ],
        { fill: ACCENT_AMBER, fillStyle: "solid", strokeWidth: 1.1 },
      ),
    ],
  },
  {
    id: "icon-sun",
    name: "Sun",
    category: "icons",
    keywords: ["day", "light", "bright", "weather", "morning"],
    build: () => {
      const els = [
        ellipse(16, 16, 30, 30, { fill: ACCENT_AMBER, strokeWidth: 1.6 }),
      ];
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const x1 = 31 + Math.cos(angle) * 21;
        const y1 = 31 + Math.sin(angle) * 21;
        const x2 = 31 + Math.cos(angle) * 30;
        const y2 = 31 + Math.sin(angle) * 30;
        els.push(
          line(
            [
              [x1, y1],
              [x2, y2],
            ],
            { strokeWidth: 2, stroke: ACCENT_AMBER },
          ),
        );
      }
      return els;
    },
  },
  {
    id: "icon-moon",
    name: "Moon",
    category: "icons",
    keywords: ["night", "dark", "sleep", "evening", "theme"],
    build: () => [
      line(
        [
          ...arcPoints(28, 28, 26, 26, -70, 200, 20),
          ...arcPoints(16, 26, 24, 24, 190, -60, 18),
        ],
        { fill: TINT_BLUE },
      ),
    ],
  },
  {
    id: "icon-badge",
    name: "Number badge",
    category: "icons",
    keywords: ["count", "notification", "label", "circle"],
    build: () => {
      const disc = ellipse(0, 0, 40, 40, {
        fill: ACCENT_RED,
        fillStyle: "solid",
        strokeWidth: 1.2,
      });
      return [disc, label(disc, "3", { size: 18, stroke: "#ffffff" })];
    },
  },
];
