import type { LakarElement } from "../../types";
import {
  ACCENT_AMBER,
  ACCENT_BLUE,
  ACCENT_GREEN,
  ACCENT_RED,
  INK,
  INK_SOFT,
  TINT_BLUE,
  TINT_GREEN,
  TINT_PAPER,
  TINT_RED,
  TINT_SAND,
  arcPoints,
  centeredText,
  ellipse,
  label,
  line,
  rect,
  text,
  type SatchelDef,
} from "../builder";

const axes = (w: number, h: number) => [
  line(
    [
      [0, 0],
      [0, h],
      [w, h],
    ],
    { strokeWidth: 1.8 },
  ),
];

const pieSlice = (
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  fill: string,
) =>
  line(
    [[cx, cy], ...arcPoints(cx, cy, r, r, from, to, 16), [cx, cy]],
    { fill, strokeWidth: 1.3 },
  );

export const CHART_PACK: SatchelDef[] = [
  {
    id: "chart-bar",
    name: "Bar chart",
    category: "charts",
    keywords: ["graph", "columns", "compare", "data", "metrics"],
    build: () => {
      const heights = [44, 78, 58, 96, 70];
      const els = axes(180, 110);
      heights.forEach((barHeight, i) => {
        els.push(
          rect(16 + i * 32, 110 - barHeight, 22, barHeight, {
            fill: TINT_BLUE,
            strokeWidth: 1.2,
          }),
        );
      });
      return els;
    },
  },
  {
    id: "chart-line",
    name: "Line chart",
    category: "charts",
    keywords: ["trend", "graph", "growth", "series", "time"],
    build: () => [
      ...axes(180, 110),
      line(
        [
          [12, 88],
          [48, 62],
          [84, 72],
          [120, 34],
          [168, 16],
        ],
        { stroke: ACCENT_BLUE, strokeWidth: 2.2, round: true },
      ),
      line(
        [
          [12, 100],
          [48, 92],
          [84, 96],
          [120, 78],
          [168, 66],
        ],
        {
          stroke: ACCENT_RED,
          strokeWidth: 1.8,
          strokeStyle: "dashed",
          round: true,
        },
      ),
    ],
  },
  {
    id: "chart-pie",
    name: "Pie chart",
    category: "charts",
    keywords: ["share", "split", "percent", "proportion", "slices"],
    build: () => [
      pieSlice(60, 60, 60, -90, 30, TINT_BLUE),
      pieSlice(60, 60, 60, 30, 140, TINT_GREEN),
      pieSlice(60, 60, 60, 140, 270, TINT_SAND),
    ],
  },
  {
    id: "chart-donut",
    name: "Donut chart",
    category: "charts",
    keywords: ["ring", "share", "percent", "progress", "kpi"],
    build: () => {
      const hole = ellipse(28, 28, 64, 64, { fill: "#ffffff" });
      return [
        ellipse(0, 0, 120, 120, { fill: TINT_PAPER }),
        line(arcPoints(60, 60, 60, 60, -90, 130, 20), {
          stroke: ACCENT_GREEN,
          strokeWidth: 14,
        }),
        hole,
        label(hole, "61%", { size: 18, stroke: INK }),
      ];
    },
  },
  {
    id: "chart-sparkline",
    name: "Sparkline tile",
    category: "charts",
    keywords: ["kpi", "stat", "metric", "trend", "tile"],
    build: () => [
      rect(0, 0, 160, 96, { fill: "#ffffff", round: true }),
      text(14, 12, "Signups", { size: 13, stroke: INK_SOFT }),
      text(14, 30, "1,284", { size: 24, stroke: INK }),
      line(
        [
          [14, 82],
          [42, 72],
          [66, 78],
          [92, 62],
          [120, 66],
          [146, 52],
        ],
        { stroke: ACCENT_GREEN, strokeWidth: 2, round: true },
      ),
    ],
  },
  {
    id: "chart-kanban",
    name: "Kanban board",
    category: "charts",
    keywords: ["board", "cards", "sprint", "agile", "columns"],
    build: () => {
      const els: LakarElement[] = [];
      const titles = ["To do", "Doing", "Done"];
      const counts = [3, 2, 1];
      titles.forEach((title, col) => {
        const x = col * 94;
        els.push(rect(x, 0, 84, 168, { fill: TINT_PAPER, round: true }));
        els.push(text(x + 10, 8, title, { size: 13, stroke: INK_SOFT }));
        for (let i = 0; i < counts[col]; i++) {
          els.push(
            rect(x + 8, 32 + i * 40, 68, 32, {
              fill: "#ffffff",
              round: true,
              strokeWidth: 1.2,
            }),
          );
        }
      });
      return els;
    },
  },
  {
    id: "chart-timeline",
    name: "Timeline",
    category: "charts",
    keywords: ["roadmap", "milestones", "history", "steps", "when"],
    build: () => {
      const els = [
        line(
          [
            [0, 40],
            [260, 40],
          ],
          { strokeWidth: 2 },
        ),
      ];
      const labels = ["Jan", "Mar", "Jun", "Sep"];
      labels.forEach((label, i) => {
        const x = 20 + i * 74;
        els.push(
          ellipse(x - 9, 31, 18, 18, { fill: TINT_BLUE, strokeWidth: 1.4 }),
        );
        els.push(text(x - 14, 58, label, { size: 13, stroke: INK_SOFT }));
      });
      return els;
    },
  },
  {
    id: "chart-gantt",
    name: "Gantt rows",
    category: "charts",
    keywords: ["schedule", "plan", "project", "bars", "tasks"],
    build: () => {
      const els = [rect(0, 0, 240, 116, { fill: "#ffffff" })];
      const bars = [
        [12, 96, TINT_BLUE],
        [56, 120, TINT_GREEN],
        [104, 80, TINT_SAND],
      ] as const;
      bars.forEach(([x, w, fill], i) => {
        els.push(
          rect(x, 14 + i * 34, w, 22, { fill, strokeWidth: 1.2, round: true }),
        );
        els.push(
          line(
            [
              [0, 6 + i * 34 + 34],
              [240, 6 + i * 34 + 34],
            ],
            { stroke: INK_SOFT, strokeWidth: 0.9 },
          ),
        );
      });
      return els;
    },
  },
  {
    id: "chart-funnel",
    name: "Funnel",
    category: "charts",
    keywords: ["conversion", "stages", "drop-off", "pipeline", "sales"],
    build: () => {
      const els: LakarElement[] = [];
      const widths = [180, 140, 100, 60];
      const fills = [TINT_BLUE, TINT_GREEN, TINT_SAND, TINT_RED];
      widths.forEach((w, i) => {
        const x = (180 - w) / 2;
        els.push(rect(x, i * 34, w, 28, { fill: fills[i], strokeWidth: 1.2 }));
      });
      return els;
    },
  },
  {
    id: "chart-venn",
    name: "Venn diagram",
    category: "charts",
    keywords: ["overlap", "intersection", "sets", "compare", "circles"],
    build: () => [
      ellipse(0, 0, 110, 110, { fill: TINT_BLUE, opacity: 70 }),
      ellipse(70, 0, 110, 110, { fill: TINT_SAND, opacity: 70 }),
    ],
  },
  {
    id: "chart-stat-row",
    name: "Stat row",
    category: "charts",
    keywords: ["kpi", "metrics", "dashboard", "numbers", "summary"],
    build: () => {
      const els: LakarElement[] = [];
      const stats: [string, string, string][] = [
        ["Users", "8.4k", ACCENT_BLUE],
        ["Revenue", "$21k", ACCENT_GREEN],
        ["Churn", "2.1%", ACCENT_AMBER],
      ];
      stats.forEach(([label, value, color], i) => {
        const x = i * 108;
        els.push(rect(x, 0, 96, 74, { fill: "#ffffff", round: true }));
        els.push(text(x + 12, 10, label, { size: 12, stroke: INK_SOFT }));
        els.push(text(x + 12, 30, value, { size: 22, stroke: color }));
      });
      return els;
    },
  },
  {
    id: "chart-mindmap",
    name: "Mind map",
    category: "charts",
    keywords: ["brainstorm", "tree", "branches", "ideas", "notes"],
    build: () => {
      const hub = ellipse(70, 60, 96, 52, { fill: TINT_SAND });
      return [
      hub,
      label(hub, "Topic", { size: 15, stroke: INK }),
      ellipse(0, 0, 76, 40, { fill: "#ffffff" }),
      ellipse(0, 118, 76, 40, { fill: "#ffffff" }),
      ellipse(200, 6, 76, 40, { fill: "#ffffff" }),
      ellipse(200, 110, 76, 40, { fill: "#ffffff" }),
      line(
        [
          [70, 74],
          [50, 30],
        ],
        { round: true, strokeWidth: 1.5 },
      ),
      line(
        [
          [70, 98],
          [50, 132],
        ],
        { round: true, strokeWidth: 1.5 },
      ),
      line(
        [
          [166, 74],
          [200, 34],
        ],
        { round: true, strokeWidth: 1.5 },
      ),
      line(
        [
          [166, 98],
          [200, 126],
        ],
        { round: true, strokeWidth: 1.5 },
      ),
      ];
    },
  },
];
