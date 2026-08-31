import type {
  ItemDefaults,
  LakarElement,
  LinearElement,
  TextElement,
} from "./types";
import { createElement, mutateElement } from "./elements";
import { measureText } from "./text/measure";
import { syncBoundText } from "./boundText";
import { makeBinding, updateBoundPoints } from "./binding";
import { TEXT_LINE_HEIGHT } from "./constants";

export type Direction = "TD" | "LR";

type NodeShape = "rectangle" | "diamond" | "ellipse" | "rounded";

interface ParsedNode {
  key: string;
  label: string;
  shape: NodeShape;
}

interface ParsedEdge {
  from: string;
  to: string;
  label: string | null;
  dashed: boolean;
  arrow: boolean;
}

export interface ParsedFlow {
  direction: Direction;
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

export class MermaidError extends Error {}

const NODE_RE =
  /^([A-Za-z0-9_.-]+)\s*(\(\((.*?)\)\)|\[\[(.*?)\]\]|\[\((.*?)\)\]|\[(.*?)\]|\((.*?)\)|\{(.*?)\})?\s*$/;

const LINK_RE = /(-\.-+>|-\.-+|={2,}>|={2,}|-{2,}>|-{2,})/;

const stripQuotes = (s: string) =>
  s.replace(/^["'`]|["'`]$/g, "").replace(/<br\s*\/?>/gi, "\n").trim();

const parseNodeToken = (
  raw: string,
  nodes: Map<string, ParsedNode>,
): string => {
  const token = raw.trim();
  const m = NODE_RE.exec(token);
  if (!m) {
    throw new MermaidError(`Cannot read "${token}"`);
  }
  const key = m[1];
  let shape: NodeShape = "rectangle";
  let label: string | undefined;
  if (m[3] !== undefined) {
    shape = "ellipse";
    label = m[3];
  } else if (m[4] !== undefined) {
    shape = "rectangle";
    label = m[4];
  } else if (m[5] !== undefined) {
    shape = "rounded";
    label = m[5];
  } else if (m[6] !== undefined) {
    shape = "rectangle";
    label = m[6];
  } else if (m[7] !== undefined) {
    shape = "rounded";
    label = m[7];
  } else if (m[8] !== undefined) {
    shape = "diamond";
    label = m[8];
  }

  const existing = nodes.get(key);
  if (existing) {
    if (label !== undefined) {
      existing.label = stripQuotes(label) || key;
      existing.shape = shape;
    }
    return key;
  }
  nodes.set(key, {
    key,
    label: label !== undefined ? stripQuotes(label) || key : key,
    shape,
  });
  return key;
};

export const MAX_SOURCE_CHARS = 20_000;
export const MAX_NODES = 300;
export const MAX_EDGES = 600;

export const parseMermaid = (source: string): ParsedFlow => {
  if (source.length > MAX_SOURCE_CHARS) {
    throw new MermaidError(
      `That is longer than ${MAX_SOURCE_CHARS.toLocaleString()} characters`,
    );
  }
  const nodes = new Map<string, ParsedNode>();
  const edges: ParsedEdge[] = [];
  let direction: Direction = "TD";
  let sawHeader = false;

  const lines = source
    .split("\n")
    .map((l) => l.replace(/%%.*$/, "").trim())
    .filter(Boolean);

  if (!lines.length) throw new MermaidError("Nothing to import");

  for (const line of lines) {
    const header = /^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)?\s*$/i.exec(line);
    if (header) {
      sawHeader = true;
      const d = (header[1] ?? "TD").toUpperCase();
      direction = d === "LR" || d === "RL" ? "LR" : "TD";
      continue;
    }
    if (/^(subgraph|end|classDef|class|style|linkStyle|click)\b/i.test(line)) {
      continue;
    }

    const withLabel = /^(.*?)\s+--+\s*([^->|]+?)\s*--+>\s*(.*)$/.exec(line);
    if (withLabel) {
      const from = parseNodeToken(withLabel[1], nodes);
      const to = parseNodeToken(withLabel[3], nodes);
      edges.push({
        from,
        to,
        label: stripQuotes(withLabel[2]) || null,
        dashed: false,
        arrow: true,
      });
      continue;
    }

    const parts = line.split(LINK_RE);
    if (parts.length >= 3) {
      let prevKey: string | null = null;
      for (let i = 1; i < parts.length; i += 2) {
        const link = parts[i];
        let right = parts[i + 1] ?? "";
        let label: string | null = null;
        const piped = /^\s*\|([^|]*)\|\s*(.*)$/.exec(right);
        if (piped) {
          label = stripQuotes(piped[1]) || null;
          right = piped[2];
        }
        if (!right.trim()) break;
        const fromKey = prevKey ?? parseNodeToken(parts[i - 1], nodes);
        const toKey = parseNodeToken(right, nodes);
        edges.push({
          from: fromKey,
          to: toKey,
          label,
          dashed: link.includes("."),
          arrow: link.endsWith(">"),
        });
        prevKey = toKey;
      }
      continue;
    }

    parseNodeToken(line, nodes);
  }

  if (!nodes.size) {
    throw new MermaidError(
      sawHeader ? "No nodes found" : "Start with `flowchart TD`",
    );
  }
  if (nodes.size > MAX_NODES) {
    throw new MermaidError(`Too many nodes (limit ${MAX_NODES})`);
  }
  if (edges.length > MAX_EDGES) {
    throw new MermaidError(`Too many arrows (limit ${MAX_EDGES})`);
  }

  return { direction, nodes: [...nodes.values()], edges };
};

const NODE_PAD_X = 26;
const NODE_PAD_Y = 20;
const MIN_W = 90;
const MIN_H = 52;
const GAP_MAIN = 90;
const GAP_CROSS = 44;

interface Placed extends ParsedNode {
  w: number;
  h: number;
  x: number;
  y: number;
  rank: number;
}

const computeRanks = (flow: ParsedFlow): Map<string, number> => {
  const rank = new Map<string, number>();
  for (const n of flow.nodes) rank.set(n.key, 0);
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    if (e.from === e.to) continue;
    const list = incoming.get(e.to);
    if (list) list.push(e.from);
    else incoming.set(e.to, [e.from]);
  }
  for (let pass = 0; pass < flow.nodes.length + 2; pass++) {
    let changed = false;
    for (const n of flow.nodes) {
      const preds = incoming.get(n.key);
      if (!preds?.length) continue;
      const best = Math.max(...preds.map((p) => (rank.get(p) ?? 0) + 1));
      if (best > (rank.get(n.key) ?? 0) && best < flow.nodes.length) {
        rank.set(n.key, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
};

const layout = (flow: ParsedFlow, fontSize: number): Placed[] => {
  const ranks = computeRanks(flow);
  const placed: Placed[] = flow.nodes.map((n) => {
    const metrics = measureText(n.label, "hand", fontSize, TEXT_LINE_HEIGHT);
    const isDiamond = n.shape === "diamond";
    return {
      ...n,
      w: Math.max(MIN_W, metrics.width + NODE_PAD_X * (isDiamond ? 3 : 2)),
      h: Math.max(MIN_H, metrics.height + NODE_PAD_Y * (isDiamond ? 2.2 : 2)),
      x: 0,
      y: 0,
      rank: ranks.get(n.key) ?? 0,
    };
  });

  const byRank = new Map<number, Placed[]>();
  for (const p of placed) {
    const list = byRank.get(p.rank);
    if (list) list.push(p);
    else byRank.set(p.rank, [p]);
  }

  const vertical = flow.direction === "TD";
  const rankKeys = [...byRank.keys()].sort((a, b) => a - b);
  let mainOffset = 0;
  const rows: { extent: number; items: Placed[] }[] = [];

  for (const key of rankKeys) {
    const items = byRank.get(key)!;
    const extent = Math.max(...items.map((p) => (vertical ? p.h : p.w)));
    let cross = 0;
    for (const p of items) {
      if (vertical) {
        p.x = cross;
        p.y = mainOffset + (extent - p.h) / 2;
        cross += p.w + GAP_CROSS;
      } else {
        p.y = cross;
        p.x = mainOffset + (extent - p.w) / 2;
        cross += p.h + GAP_CROSS;
      }
    }
    rows.push({ extent, items });
    mainOffset += extent + GAP_MAIN;
  }

  let widest = 0;
  for (const row of rows) {
    const span = row.items.reduce(
      (acc, p) => acc + (vertical ? p.w : p.h) + GAP_CROSS,
      -GAP_CROSS,
    );
    widest = Math.max(widest, span);
  }
  for (const row of rows) {
    const span = row.items.reduce(
      (acc, p) => acc + (vertical ? p.w : p.h) + GAP_CROSS,
      -GAP_CROSS,
    );
    const shift = (widest - span) / 2;
    for (const p of row.items) {
      if (vertical) p.x += shift;
      else p.y += shift;
    }
  }

  return placed;
};

export const buildFlowElements = (
  flow: ParsedFlow,
  defaults: ItemDefaults,
  origin: { x: number; y: number },
): LakarElement[] => {
  const fontSize = defaults.fontSize;
  const placed = layout(flow, fontSize);
  const out: LakarElement[] = [];
  const byKey = new Map<string, LakarElement>();

  for (const p of placed) {
    const type =
      p.shape === "diamond"
        ? "diamond"
        : p.shape === "ellipse"
          ? "ellipse"
          : "rectangle";
    const shape = createElement({
      type,
      x: origin.x + p.x,
      y: origin.y + p.y,
      defaults,
    });
    mutateElement(shape, {
      width: p.w,
      height: p.h,
      roundEdges: p.shape === "rounded" ? true : shape.roundEdges,
    });
    out.push(shape);
    byKey.set(p.key, shape);

    const label = createElement({
      type: "text",
      x: shape.x,
      y: shape.y,
      defaults,
    }) as TextElement;
    mutateElement(label, {
      containerId: shape.id,
      text: p.label,
      originalText: p.label,
      textAlign: "center",
      fontSize,
      lineHeight: TEXT_LINE_HEIGHT,
    });
    out.push(label);
  }

  for (const shape of out) {
    if (shape.type === "rectangle" || shape.type === "diamond" || shape.type === "ellipse") {
      syncBoundText(out, shape);
    }
  }

  const vertical = flow.direction === "TD";
  const byPlaced = new Map(placed.map((p) => [p.key, p]));
  const lateralEdge = placed.reduce(
    (acc, p) =>
      Math.max(acc, vertical ? origin.x + p.x + p.w : origin.y + p.y + p.h),
    -Infinity,
  );
  const detours = new Map<number, number>();

  const edgeLabels: LakarElement[] = [];
  for (const e of flow.edges) {
    const from = byKey.get(e.from);
    const to = byKey.get(e.to);
    if (!from || !to || from === to) continue;

    const arrow = createElement({
      type: "arrow",
      x: 0,
      y: 0,
      defaults,
    }) as LinearElement;
    const fc = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const tc = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

    const span = Math.abs(
      (byPlaced.get(e.to)?.rank ?? 0) - (byPlaced.get(e.from)?.rank ?? 0),
    );
    const points: [number, number][] = [[0, 0]];
    let labelAnchor = { x: (fc.x + tc.x) / 2, y: (fc.y + tc.y) / 2 };

    if (span > 1) {
      const lane = (detours.get(span) ?? 0) + 1;
      detours.set(span, lane);
      const offset = lateralEdge + 30 + lane * 26;
      const mid = vertical
        ? { x: offset, y: (fc.y + tc.y) / 2 }
        : { x: (fc.x + tc.x) / 2, y: offset };
      points.push([mid.x - fc.x, mid.y - fc.y]);
      labelAnchor = vertical
        ? { x: offset, y: fc.y + (tc.y - fc.y) * 0.28 }
        : { x: fc.x + (tc.x - fc.x) * 0.28, y: offset };
    }
    points.push([tc.x - fc.x, tc.y - fc.y]);

    mutateElement(arrow, {
      x: fc.x,
      y: fc.y,
      points,
      startArrowhead: "none",
      endArrowhead: e.arrow ? "arrow" : "none",
      strokeStyle: e.dashed ? "dashed" : defaults.strokeStyle,
      startBinding: makeBinding(from, fc),
      endBinding: makeBinding(to, tc),
    } as Partial<LinearElement>);
    out.push(arrow);

    if (e.label) {
      const metrics = measureText(
        e.label,
        "hand",
        Math.max(12, fontSize - 4),
        TEXT_LINE_HEIGHT,
      );
      const text = createElement({
        type: "text",
        x: labelAnchor.x - metrics.width / 2,
        y: labelAnchor.y - metrics.height / 2,
        defaults,
      }) as TextElement;
      mutateElement(text, {
        text: e.label,
        originalText: e.label,
        fontSize: Math.max(12, fontSize - 4),
        textAlign: "center",
        lineHeight: TEXT_LINE_HEIGHT,
        width: metrics.width,
        height: metrics.height,
      });
      edgeLabels.push(text);
    }
  }

  const all = [...out, ...edgeLabels];
  const byId = new Map(all.map((el) => [el.id, el]));
  for (const el of all) {
    if (el.type === "arrow") updateBoundPoints(byId, el as LinearElement);
  }
  return all;
};

export const SAMPLE_MERMAID = `flowchart TD
  A[Client] --> B{Cache hit?}
  B -->|yes| C[Return cached]
  B -->|no| D[Query database]
  D --> E[(Write cache)]
  E --> C`;
