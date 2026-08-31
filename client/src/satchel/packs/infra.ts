import {
  ACCENT_AMBER,
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
  polygonPoints,
  rect,
  text,
  type SatchelDef,
} from "../builder";

const cloudPoints = (
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] => {
  const s = w / 100;
  const t = h / 60;
  const pt = (px: number, py: number): [number, number] => [
    x + px * s,
    y + py * t,
  ];
  return [
    pt(18, 58),
    ...arcPoints(x + 18 * s, y + 44 * t, 16 * s, 14 * t, 90, 250, 10),
    ...arcPoints(x + 38 * s, y + 26 * t, 20 * s, 20 * t, 190, 320, 10),
    ...arcPoints(x + 68 * s, y + 28 * t, 18 * s, 18 * t, 250, 380, 10),
    ...arcPoints(x + 84 * s, y + 44 * t, 15 * s, 14 * t, 300, 450, 10),
    pt(18, 58),
  ];
};

const rackUnit = (x: number, y: number, w: number, h: number) => [
  rect(x, y, w, h, { fill: "#ffffff", strokeWidth: 1.2 }),
  ellipse(x + w - 16, y + h / 2 - 4, 8, 8, { fill: TINT_GREEN, strokeWidth: 0.8 }),
  line([
    [x + 10, y + h / 2],
    [x + w - 26, y + h / 2],
  ], { stroke: INK_SOFT, strokeWidth: 1 }),
];

export const INFRA_PACK: SatchelDef[] = [
  {
    id: "infra-cloud",
    name: "Cloud",
    category: "infra",
    keywords: ["aws", "internet", "saas", "hosted"],
    build: () => [line(cloudPoints(0, 0, 150, 90), { fill: "#ffffff", round: true })],
  },
  {
    id: "infra-cloud-labelled",
    name: "Cloud service",
    category: "infra",
    keywords: ["provider", "platform", "region", "internet"],
    build: () => [
      line(cloudPoints(0, 0, 170, 100), { fill: TINT_BLUE, round: true }),
      centeredText(85, 62, "Cloud", { size: 16, stroke: INK }),
    ],
  },
  {
    id: "infra-server",
    name: "Server",
    category: "infra",
    keywords: ["host", "machine", "vm", "compute", "box"],
    build: () => [
      rect(0, 0, 120, 96, { fill: TINT_PAPER, round: true }),
      ...rackUnit(10, 12, 100, 22),
      ...rackUnit(10, 40, 100, 22),
      ...rackUnit(10, 68, 100, 22),
    ],
  },
  {
    id: "infra-rack",
    name: "Server rack",
    category: "infra",
    keywords: ["datacenter", "cluster", "hardware", "stack"],
    build: () => {
      const els = [rect(0, 0, 128, 190, { fill: TINT_PAPER, round: true })];
      for (let i = 0; i < 6; i++) els.push(...rackUnit(10, 10 + i * 30, 108, 22));
      return els;
    },
  },
  {
    id: "infra-database",
    name: "Database node",
    category: "infra",
    keywords: ["postgres", "sql", "store", "cylinder", "db"],
    build: () => {
      const w = 104;
      const h = 118;
      const ry = 16;
      return [
        line(
          [
            [0, ry],
            [0, h - ry],
            ...arcPoints(w / 2, h - ry, w / 2, ry, 180, 360, 14),
            [w, ry],
          ],
          { fill: TINT_GREEN },
        ),
        ellipse(0, 0, w, ry * 2, { fill: "#ffffff" }),
        line(arcPoints(w / 2, ry * 2.2, w / 2 - 3, ry * 0.7, 0, 180, 12), {
          stroke: INK_SOFT,
          strokeWidth: 1,
        }),
        line(arcPoints(w / 2, ry * 3.4, w / 2 - 3, ry * 0.7, 0, 180, 12), {
          stroke: INK_SOFT,
          strokeWidth: 1,
        }),
      ];
    },
  },
  {
    id: "infra-cache",
    name: "Cache",
    category: "infra",
    keywords: ["redis", "memory", "fast", "lightning"],
    build: () => [
      rect(0, 0, 112, 80, { fill: TINT_SAND, round: true }),
      line(
        [
          [62, 14],
          [42, 44],
          [56, 44],
          [48, 68],
          [72, 36],
          [58, 36],
          [62, 14],
        ],
        { fill: ACCENT_AMBER, fillStyle: "solid", strokeWidth: 1.3 },
      ),
    ],
  },
  {
    id: "infra-queue",
    name: "Queue",
    category: "infra",
    keywords: ["kafka", "messages", "buffer", "stream", "pipeline"],
    build: () => [
      rect(0, 0, 180, 60, { fill: "#ffffff", round: true }),
      rect(12, 12, 32, 36, { fill: TINT_BLUE, strokeWidth: 1.1 }),
      rect(52, 12, 32, 36, { fill: TINT_BLUE, strokeWidth: 1.1 }),
      rect(92, 12, 32, 36, { fill: TINT_BLUE, strokeWidth: 1.1 }),
      line(
        [
          [140, 30],
          [168, 30],
        ],
        { strokeWidth: 1.6, stroke: INK_SOFT },
      ),
    ],
  },
  {
    id: "infra-loadbalancer",
    name: "Load balancer",
    category: "infra",
    keywords: ["proxy", "nginx", "distribute", "traffic"],
    build: () => [
      line(polygonPoints(52, 52, 52, 6, -90), { fill: TINT_BLUE }),
      line(
        [
          [28, 52],
          [46, 52],
        ],
        { strokeWidth: 1.6 },
      ),
      line(
        [
          [58, 34],
          [76, 34],
        ],
        { strokeWidth: 1.6 },
      ),
      line(
        [
          [58, 52],
          [76, 52],
        ],
        { strokeWidth: 1.6 },
      ),
      line(
        [
          [58, 70],
          [76, 70],
        ],
        { strokeWidth: 1.6 },
      ),
    ],
  },
  {
    id: "infra-firewall",
    name: "Firewall",
    category: "infra",
    keywords: ["security", "wall", "bricks", "block", "waf"],
    build: () => {
      const els = [rect(0, 0, 140, 84, { fill: TINT_RED })];
      for (let row = 0; row < 3; row++) {
        els.push(
          line([
            [0, 28 * (row + 1)],
            [140, 28 * (row + 1)],
          ], { strokeWidth: 1.2 }),
        );
        const offset = row % 2 === 0 ? 35 : 0;
        for (let x = offset; x < 140; x += 70) {
          if (x === 0) continue;
          els.push(
            line([
              [x, 28 * row],
              [x, 28 * (row + 1)],
            ], { strokeWidth: 1.2 }),
          );
        }
      }
      return els;
    },
  },
  {
    id: "infra-container",
    name: "Container",
    category: "infra",
    keywords: ["docker", "pod", "image", "package"],
    build: () => {
      const body = rect(0, 16, 124, 84, { fill: TINT_BLUE, round: true });
      return [
        body,
        line(
          [
            [0, 40],
            [124, 40],
          ],
          { strokeWidth: 1.3 },
        ),
        rect(28, 0, 68, 22, { fill: "#ffffff", strokeWidth: 1.2, round: true }),
        label(body, "app", { size: 15, stroke: INK }),
      ];
    },
  },
  {
    id: "infra-kubernetes",
    name: "Cluster node",
    category: "infra",
    keywords: ["kubernetes", "k8s", "hexagon", "pod", "node"],
    build: () => [
      line(polygonPoints(56, 56, 56, 6, -90), { fill: TINT_GREEN }),
      line(polygonPoints(56, 56, 26, 6, -90), { strokeWidth: 1.3 }),
    ],
  },
  {
    id: "infra-function",
    name: "Function",
    category: "infra",
    keywords: ["lambda", "serverless", "handler", "code"],
    build: () => {
      const box = rect(0, 0, 124, 76, { fill: TINT_SAND, round: true });
      return [
        box,
        label(box, "ƒ(x)", { size: 22, stroke: INK, font: "code" }),
      ];
    },
  },
  {
    id: "infra-api",
    name: "API gateway",
    category: "infra",
    keywords: ["endpoint", "rest", "gateway", "edge"],
    build: () => {
      const box = rect(0, 0, 148, 72, { fill: "#ffffff", round: true });
      return [
        box,
        line(
          [
            [36, 0],
            [36, 72],
          ],
          { strokeStyle: "dashed", strokeWidth: 1.2, stroke: INK_SOFT },
        ),
        line(
          [
            [112, 0],
            [112, 72],
          ],
          { strokeStyle: "dashed", strokeWidth: 1.2, stroke: INK_SOFT },
        ),
        label(box, "API", { size: 17, stroke: INK }),
      ];
    },
  },
  {
    id: "infra-bucket",
    name: "Storage bucket",
    category: "infra",
    keywords: ["s3", "object", "blob", "files", "store"],
    build: () => [
      line(
        [
          [12, 0],
          [108, 0],
          [92, 92],
          [28, 92],
          [12, 0],
        ],
        { fill: TINT_GREEN },
      ),
      ellipse(12, -10, 96, 22, { fill: "#ffffff", strokeWidth: 1.3 }),
    ],
  },
  {
    id: "infra-router",
    name: "Router",
    category: "infra",
    keywords: ["network", "switch", "gateway", "hub"],
    build: () => [
      rect(0, 24, 132, 44, { fill: TINT_PAPER, round: true }),
      ellipse(14, 44, 10, 10, { fill: TINT_GREEN, strokeWidth: 0.9 }),
      ellipse(32, 44, 10, 10, { fill: TINT_GREEN, strokeWidth: 0.9 }),
      line(
        [
          [86, 40],
          [110, 16],
        ],
        { strokeWidth: 1.6 },
      ),
      line(
        [
          [110, 16],
          [102, 16],
        ],
        { strokeWidth: 1.6 },
      ),
      line(
        [
          [110, 16],
          [110, 24],
        ],
        { strokeWidth: 1.6 },
      ),
    ],
  },
  {
    id: "infra-cdn",
    name: "Edge network",
    category: "infra",
    keywords: ["cdn", "globe", "world", "distributed", "pop"],
    build: () => {
      const els = [
        ellipse(0, 0, 110, 110, { fill: TINT_BLUE }),
        ellipse(38, 0, 34, 110, { strokeWidth: 1.2 }),
        line(
          [
            [4, 40],
            [106, 40],
          ],
          { strokeWidth: 1.2 },
        ),
        line(
          [
            [4, 72],
            [106, 72],
          ],
          { strokeWidth: 1.2 },
        ),
      ];
      for (const [cx, cy] of [
        [22, 30],
        [86, 34],
        [56, 88],
      ]) {
        els.push(ellipse(cx - 6, cy - 6, 12, 12, { fill: ACCENT_RED, strokeWidth: 0.9 }));
      }
      return els;
    },
  },
  {
    id: "infra-monitor",
    name: "Monitoring",
    category: "infra",
    keywords: ["metrics", "observability", "graph", "alerts"],
    build: () => [
      rect(0, 0, 148, 96, { fill: "#ffffff", round: true }),
      line(
        [
          [14, 74],
          [40, 46],
          [62, 60],
          [88, 26],
          [112, 40],
          [134, 18],
        ],
        { stroke: ACCENT_RED, strokeWidth: 2, round: true },
      ),
    ],
  },
  {
    id: "infra-lock-shield",
    name: "Secure zone",
    category: "infra",
    keywords: ["shield", "protected", "vpc", "private", "security"],
    build: () => [
      line(
        [
          [56, 0],
          [112, 20],
          [112, 74],
          [56, 116],
          [0, 74],
          [0, 20],
          [56, 0],
        ],
        { fill: TINT_GREEN },
      ),
      rect(40, 52, 32, 26, { fill: "#ffffff", strokeWidth: 1.3 }),
      line(arcPoints(56, 52, 11, 13, 180, 360, 12), { strokeWidth: 1.6 }),
    ],
  },
];

export const PEOPLE_PACK: SatchelDef[] = [
  {
    id: "people-actor",
    name: "Person",
    category: "people",
    keywords: ["actor", "user", "stick figure", "human", "who"],
    build: () => [
      ellipse(20, 0, 32, 32, { fill: "#ffffff" }),
      line(
        [
          [36, 34],
          [36, 78],
        ],
        { strokeWidth: 1.8 },
      ),
      line(
        [
          [8, 50],
          [64, 50],
        ],
        { strokeWidth: 1.8 },
      ),
      line(
        [
          [36, 78],
          [12, 116],
        ],
        { strokeWidth: 1.8 },
      ),
      line(
        [
          [36, 78],
          [60, 116],
        ],
        { strokeWidth: 1.8 },
      ),
    ],
  },
  {
    id: "people-user",
    name: "User badge",
    category: "people",
    keywords: ["profile", "account", "avatar", "person"],
    build: () => [
      ellipse(22, 0, 36, 36, { fill: TINT_BLUE }),
      line(arcPoints(40, 82, 40, 44, 180, 360, 18), { fill: TINT_BLUE }),
    ],
  },
  {
    id: "people-team",
    name: "Team",
    category: "people",
    keywords: ["group", "people", "squad", "users", "three"],
    build: () => [
      ellipse(0, 14, 30, 30, { fill: TINT_PAPER }),
      line(arcPoints(15, 82, 30, 34, 180, 360, 14), { fill: TINT_PAPER }),
      ellipse(72, 14, 30, 30, { fill: TINT_PAPER }),
      line(arcPoints(87, 82, 30, 34, 180, 360, 14), { fill: TINT_PAPER }),
      ellipse(34, 0, 36, 36, { fill: TINT_BLUE }),
      line(arcPoints(52, 82, 38, 42, 180, 360, 16), { fill: TINT_BLUE }),
    ],
  },
  {
    id: "people-building",
    name: "Building",
    category: "people",
    keywords: ["office", "company", "org", "enterprise", "hq"],
    build: () => {
      const els = [rect(0, 0, 116, 148, { fill: TINT_PAPER })];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          els.push(
            rect(16 + col * 30, 18 + row * 30, 18, 18, {
              fill: "#ffffff",
              strokeWidth: 1.1,
            }),
          );
        }
      }
      els.push(rect(44, 116, 28, 32, { fill: "#ffffff", strokeWidth: 1.2 }));
      return els;
    },
  },
  {
    id: "people-house",
    name: "House",
    category: "people",
    keywords: ["home", "local", "on-prem", "roof"],
    build: () => [
      line(
        [
          [0, 56],
          [64, 4],
          [128, 56],
        ],
        { fill: TINT_RED, strokeWidth: 1.6 },
      ),
      rect(14, 56, 100, 74, { fill: "#ffffff" }),
      rect(52, 88, 26, 42, { fill: TINT_PAPER, strokeWidth: 1.2 }),
    ],
  },
  {
    id: "people-globe",
    name: "Globe",
    category: "people",
    keywords: ["world", "internet", "global", "earth", "public"],
    build: () => [
      ellipse(0, 0, 112, 112, { fill: TINT_BLUE }),
      ellipse(38, 0, 36, 112, { strokeWidth: 1.2 }),
      line(
        [
          [5, 40],
          [107, 40],
        ],
        { strokeWidth: 1.2 },
      ),
      line(
        [
          [5, 72],
          [107, 72],
        ],
        { strokeWidth: 1.2 },
      ),
    ],
  },
  {
    id: "people-signpost",
    name: "Signpost",
    category: "people",
    keywords: ["direction", "choice", "way", "decision", "guide"],
    build: () => [
      line(
        [
          [46, 24],
          [46, 130],
        ],
        { strokeWidth: 2.4 },
      ),
      line(
        [
          [0, 12],
          [82, 12],
          [96, 28],
          [82, 44],
          [0, 44],
          [0, 12],
        ],
        { fill: TINT_SAND },
      ),
      line(
        [
          [96, 60],
          [14, 60],
          [0, 76],
          [14, 92],
          [96, 92],
          [96, 60],
        ],
        { fill: TINT_GREEN },
      ),
    ],
  },
  {
    id: "people-desk",
    name: "Workstation",
    category: "people",
    keywords: ["desk", "laptop", "office", "work", "computer"],
    build: () => [
      rect(16, 0, 116, 76, { fill: "#ffffff", round: true }),
      line(
        [
          [0, 88],
          [148, 88],
        ],
        { strokeWidth: 2 },
      ),
      line(
        [
          [16, 76],
          [132, 76],
        ],
        { strokeWidth: 1.4 },
      ),
      text(38, 26, "</>", { size: 20, stroke: INK_SOFT, font: "code" }),
    ],
  },
];
