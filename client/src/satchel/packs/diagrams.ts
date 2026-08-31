import {
  ACCENT_BLUE,
  INK,
  INK_SOFT,
  TINT_BLUE,
  TINT_GREEN,
  TINT_PAPER,
  TINT_SAND,
  arcPoints,
  arrow,
  centeredText,
  diamond,
  ellipse,
  label,
  line,
  rect,
  text,
  type SatchelDef,
} from "../builder";

const stadiumPoints = (
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] => {
  const r = h / 2;
  return [
    [x + r, y],
    [x + w - r, y],
    ...arcPoints(x + w - r, y + r, r, r, -90, 90, 12),
    [x + r, y + h],
    ...arcPoints(x + r, y + r, r, r, 90, 270, 12),
    [x + r, y],
  ];
};

const docPoints = (
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] => {
  const wave = h * 0.09;
  const pts: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h - wave],
  ];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x + w - w * t;
    const py = y + h - wave + Math.sin(t * Math.PI * 2) * wave;
    pts.push([px, py]);
  }
  pts.push([x, y]);
  return pts;
};

export const DIAGRAM_PACK: SatchelDef[] = [
  {
    id: "flow-process",
    name: "Process",
    category: "flow",
    keywords: ["step", "action", "task", "box"],
    build: () => {
      const box = rect(0, 0, 148, 76, { fill: TINT_BLUE, round: true });
      return [box, label(box, "Process")];
    },
  },
  {
    id: "flow-decision",
    name: "Decision",
    category: "flow",
    keywords: ["if", "branch", "diamond", "yes", "no"],
    build: () => {
      const shape = diamond(0, 0, 156, 96, { fill: TINT_SAND });
      return [shape, label(shape, "Decision?")];
    },
  },
  {
    id: "flow-terminator",
    name: "Start / End",
    category: "flow",
    keywords: ["terminator", "begin", "stop", "stadium", "pill"],
    build: () => [
      line(stadiumPoints(0, 0, 140, 56), { fill: TINT_GREEN }),
      centeredText(70, 28, "Start"),
    ],
  },
  {
    id: "flow-data",
    name: "Data",
    category: "flow",
    keywords: ["input", "output", "parallelogram", "io"],
    build: () => [
      line(
        [
          [24, 0],
          [148, 0],
          [124, 72],
          [0, 72],
          [24, 0],
        ],
        { fill: TINT_PAPER },
      ),
      centeredText(74, 36, "Data"),
    ],
  },
  {
    id: "flow-document",
    name: "Document",
    category: "flow",
    keywords: ["report", "page", "paper", "file"],
    build: () => [
      line(docPoints(0, 0, 132, 86), { fill: "#ffffff" }),
      centeredText(66, 38, "Doc"),
    ],
  },
  {
    id: "flow-documents",
    name: "Documents",
    category: "flow",
    keywords: ["multiple", "reports", "stack", "pages"],
    build: () => [
      line(docPoints(12, 0, 128, 82), { fill: "#ffffff" }),
      line(docPoints(6, 8, 128, 82), { fill: "#ffffff" }),
      line(docPoints(0, 16, 128, 82), { fill: "#ffffff" }),
    ],
  },
  {
    id: "flow-database",
    name: "Database",
    category: "flow",
    keywords: ["storage", "cylinder", "sql", "store", "db"],
    build: () => {
      const w = 108;
      const h = 124;
      const ry = 17;
      return [
        line(
          [
            [0, ry],
            [0, h - ry],
            ...arcPoints(w / 2, h - ry, w / 2, ry, 180, 360, 14),
            [w, ry],
          ],
          { fill: TINT_BLUE },
        ),
        ellipse(0, 0, w, ry * 2, { fill: "#ffffff" }),
        line(arcPoints(w / 2, ry * 2.1, w / 2 - 2, ry * 0.8, 0, 180, 12), {
          stroke: INK_SOFT,
          strokeWidth: 1.1,
        }),
      ];
    },
  },
  {
    id: "flow-manual-input",
    name: "Manual input",
    category: "flow",
    keywords: ["keyboard", "entry", "form"],
    build: () => [
      line(
        [
          [0, 18],
          [140, 0],
          [140, 76],
          [0, 76],
          [0, 18],
        ],
        { fill: TINT_PAPER },
      ),
      centeredText(70, 44, "Input"),
    ],
  },
  {
    id: "flow-preparation",
    name: "Preparation",
    category: "flow",
    keywords: ["hexagon", "setup", "init"],
    build: () => [
      line(
        [
          [22, 0],
          [122, 0],
          [144, 38],
          [122, 76],
          [22, 76],
          [0, 38],
          [22, 0],
        ],
        { fill: TINT_GREEN },
      ),
      centeredText(72, 38, "Prepare"),
    ],
  },
  {
    id: "flow-delay",
    name: "Delay",
    category: "flow",
    keywords: ["wait", "pause", "queue", "hold"],
    build: () => [
      line(
        [
          [0, 0],
          [96, 0],
          ...arcPoints(96, 34, 34, 34, -90, 90, 14),
          [0, 68],
          [0, 0],
        ],
        { fill: TINT_SAND },
      ),
      centeredText(58, 34, "Wait"),
    ],
  },
  {
    id: "flow-predefined",
    name: "Subprocess",
    category: "flow",
    keywords: ["predefined", "function", "call", "module"],
    build: () => {
      const box = rect(0, 0, 152, 74, { fill: TINT_BLUE });
      return [
        box,
        line([
          [14, 0],
          [14, 74],
        ]),
        line([
          [138, 0],
          [138, 74],
        ]),
        label(box, "Subprocess"),
      ];
    },
  },
  {
    id: "flow-display",
    name: "Display",
    category: "flow",
    keywords: ["screen", "show", "monitor", "output"],
    build: () => [
      line(
        [
          [22, 0],
          [122, 0],
          ...arcPoints(122, 36, 30, 36, -90, 90, 14),
          [22, 72],
          [0, 36],
          [22, 0],
        ],
        { fill: TINT_PAPER },
      ),
      centeredText(74, 36, "Display"),
    ],
  },
  {
    id: "flow-offpage",
    name: "Off-page link",
    category: "flow",
    keywords: ["connector", "continue", "reference"],
    build: () => [
      line(
        [
          [0, 0],
          [84, 0],
          [84, 52],
          [42, 78],
          [0, 52],
          [0, 0],
        ],
        { fill: TINT_SAND },
      ),
      centeredText(42, 32, "A"),
    ],
  },
  {
    id: "flow-connector",
    name: "Connector",
    category: "flow",
    keywords: ["node", "junction", "circle", "point"],
    build: () => {
      const dot = ellipse(0, 0, 56, 56, { fill: "#ffffff" });
      return [dot, label(dot, "1")];
    },
  },

  {
    id: "layout-card",
    name: "Note card",
    category: "layout",
    keywords: ["card", "box", "panel", "text"],
    build: () => [
      rect(0, 0, 180, 108, { fill: "#ffffff", round: true }),
      text(16, 16, "Title", { size: 18, stroke: INK }),
      line([
        [16, 52],
        [150, 52],
      ], { stroke: INK_SOFT, strokeWidth: 1.1 }),
      line([
        [16, 68],
        [164, 68],
      ], { stroke: INK_SOFT, strokeWidth: 1.1 }),
      line([
        [16, 84],
        [122, 84],
      ], { stroke: INK_SOFT, strokeWidth: 1.1 }),
    ],
  },
  {
    id: "layout-sticky",
    name: "Sticky note",
    category: "layout",
    keywords: ["postit", "post-it", "memo", "yellow", "idea"],
    build: () => [
      line(
        [
          [0, 0],
          [128, 0],
          [128, 104],
          [22, 104],
          [0, 82],
          [0, 0],
        ],
        { fill: TINT_SAND, roughness: 1.1 },
      ),
      line(
        [
          [0, 82],
          [22, 82],
          [22, 104],
        ],
        { strokeWidth: 1.2 },
      ),
      text(14, 18, "Idea", { size: 18, stroke: INK }),
    ],
  },
  {
    id: "layout-panel",
    name: "Titled panel",
    category: "layout",
    keywords: ["header", "window", "section", "container"],
    build: () => [
      rect(0, 0, 200, 132, { fill: "#ffffff", round: true }),
      rect(0, 0, 200, 34, { fill: TINT_BLUE }),
      text(14, 9, "Section", { size: 15, stroke: INK }),
    ],
  },
  {
    id: "layout-group",
    name: "Dashed group",
    category: "layout",
    keywords: ["boundary", "region", "cluster", "container"],
    build: () => [
      rect(0, 0, 210, 140, {
        strokeStyle: "dashed",
        stroke: INK_SOFT,
        round: true,
      }),
      text(12, -22, "Group", { size: 14, stroke: INK_SOFT }),
    ],
  },
  {
    id: "layout-swimlane",
    name: "Swimlanes",
    category: "layout",
    keywords: ["lanes", "process", "roles", "matrix"],
    build: () => [
      rect(0, 0, 240, 150, { fill: "#ffffff" }),
      rect(0, 0, 56, 150, { fill: TINT_PAPER }),
      line([
        [0, 50],
        [240, 50],
      ]),
      line([
        [0, 100],
        [240, 100],
      ]),
      text(12, 18, "One", { size: 13, stroke: INK_SOFT }),
      text(12, 68, "Two", { size: 13, stroke: INK_SOFT }),
      text(10, 118, "Three", { size: 13, stroke: INK_SOFT }),
    ],
  },
  {
    id: "layout-callout",
    name: "Callout box",
    category: "layout",
    keywords: ["tooltip", "popover", "hint", "aside"],
    build: () => [
      rect(0, 0, 168, 78, { fill: "#ffffff", round: true }),
      line(
        [
          [56, 78],
          [72, 98],
          [88, 78],
        ],
        { fill: "#ffffff" },
      ),
      text(16, 26, "Remember this", { size: 15, stroke: INK }),
    ],
  },
  {
    id: "layout-columns",
    name: "Three columns",
    category: "layout",
    keywords: ["grid", "layout", "compare", "split"],
    build: () => [
      rect(0, 0, 76, 130, { fill: "#ffffff", round: true }),
      rect(88, 0, 76, 130, { fill: "#ffffff", round: true }),
      rect(176, 0, 76, 130, { fill: "#ffffff", round: true }),
    ],
  },
  {
    id: "layout-matrix",
    name: "2×2 matrix",
    category: "layout",
    keywords: ["quadrant", "grid", "prioritise", "eisenhower"],
    build: () => [
      rect(0, 0, 180, 180, { fill: "#ffffff" }),
      line([
        [90, 0],
        [90, 180],
      ]),
      line([
        [0, 90],
        [180, 90],
      ]),
      centeredText(45, 45, "A", { size: 14, stroke: INK_SOFT }),
      centeredText(135, 45, "B", { size: 14, stroke: INK_SOFT }),
      centeredText(45, 135, "C", { size: 14, stroke: INK_SOFT }),
      centeredText(135, 135, "D", { size: 14, stroke: INK_SOFT }),
    ],
  },

  {
    id: "arrow-block",
    name: "Block arrow",
    category: "arrows",
    keywords: ["fat", "direction", "right", "big"],
    build: () => [
      line(
        [
          [0, 20],
          [76, 20],
          [76, 0],
          [124, 36],
          [76, 72],
          [76, 52],
          [0, 52],
          [0, 20],
        ],
        { fill: TINT_BLUE },
      ),
    ],
  },
  {
    id: "arrow-curved",
    name: "Curved arrow",
    category: "arrows",
    keywords: ["bend", "swoop", "sweep", "link"],
    build: () => [
      arrow(
        [
          [0, 60],
          [26, 18],
          [72, 2],
          [124, 22],
        ],
        { round: true, strokeWidth: 2, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-elbow",
    name: "Elbow arrow",
    category: "arrows",
    keywords: ["right angle", "corner", "orthogonal", "step"],
    build: () => [
      arrow(
        [
          [0, 0],
          [70, 0],
          [70, 74],
          [126, 74],
        ],
        { strokeWidth: 2, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-double",
    name: "Two-way arrow",
    category: "arrows",
    keywords: ["bidirectional", "both", "sync", "exchange"],
    build: () => [
      arrow(
        [
          [0, 0],
          [136, 0],
        ],
        { strokeWidth: 2, start: "arrow", end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-loop",
    name: "Loop back",
    category: "arrows",
    keywords: ["retry", "repeat", "cycle", "again"],
    build: () => [
      arrow(arcPoints(50, 50, 46, 46, -60, 250, 24), {
        round: true,
        strokeWidth: 2,
        end: "arrow",
      }),
    ],
  },
  {
    id: "arrow-return",
    name: "Return arrow",
    category: "arrows",
    keywords: ["back", "u-turn", "undo", "rollback"],
    build: () => [
      arrow(
        [
          [126, 0],
          [22, 0],
          ...arcPoints(22, 26, 26, 26, -90, -270, 12),
          [126, 52],
        ],
        { round: true, strokeWidth: 2, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-split",
    name: "Split flow",
    category: "arrows",
    keywords: ["fork", "branch", "fan out", "diverge"],
    build: () => [
      arrow(
        [
          [0, 56],
          [56, 56],
          [56, 8],
          [120, 8],
        ],
        { strokeWidth: 2, end: "arrow" },
      ),
      arrow(
        [
          [56, 56],
          [56, 104],
          [120, 104],
        ],
        { strokeWidth: 2, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-merge",
    name: "Merge flow",
    category: "arrows",
    keywords: ["join", "converge", "fan in", "combine"],
    build: () => [
      line(
        [
          [0, 8],
          [64, 8],
          [64, 56],
        ],
        { strokeWidth: 2 },
      ),
      line(
        [
          [0, 104],
          [64, 104],
          [64, 56],
        ],
        { strokeWidth: 2 },
      ),
      arrow(
        [
          [64, 56],
          [128, 56],
        ],
        { strokeWidth: 2, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-chevron",
    name: "Chevron step",
    category: "arrows",
    keywords: ["stage", "pipeline", "progress", "banner"],
    build: () => [
      line(
        [
          [0, 0],
          [92, 0],
          [116, 30],
          [92, 60],
          [0, 60],
          [24, 30],
          [0, 0],
        ],
        { fill: TINT_GREEN },
      ),
      centeredText(58, 30, "Step", { size: 15 }),
    ],
  },
  {
    id: "arrow-zigzag",
    name: "Zigzag",
    category: "arrows",
    keywords: ["lightning", "jagged", "path", "detour"],
    build: () => [
      arrow(
        [
          [0, 0],
          [40, 34],
          [12, 52],
          [58, 92],
        ],
        { strokeWidth: 2, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-dashed-link",
    name: "Dashed link",
    category: "arrows",
    keywords: ["optional", "weak", "reference", "dotted"],
    build: () => [
      arrow(
        [
          [0, 0],
          [130, 0],
        ],
        { strokeStyle: "dashed", stroke: INK_SOFT, strokeWidth: 1.6, end: "arrow" },
      ),
    ],
  },
  {
    id: "arrow-labelled",
    name: "Labelled arrow",
    category: "arrows",
    keywords: ["annotated", "named", "edge", "relation"],
    build: () => [
      arrow(
        [
          [0, 24],
          [140, 24],
        ],
        { strokeWidth: 2, stroke: ACCENT_BLUE, end: "arrow" },
      ),
      centeredText(70, 4, "sends", { size: 14, stroke: ACCENT_BLUE }),
    ],
  },
];
