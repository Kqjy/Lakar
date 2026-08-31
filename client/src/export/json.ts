import { nanoid } from "nanoid";
import type {
  FontFamily,
  PointBinding,
  TextElement,
  LakarElement,
} from "../types";
import { isArrowElement, isLinearLike } from "../types";
import { newElementId, newVersionNonce, refreshTextDimensions } from "../elements";
import { clamp, randomSeed } from "../math";
import { isSceneLink, normalizeLink } from "../links";
import { DEFAULT_CANVAS_BG, TEXT_LINE_HEIGHT } from "../constants";
import { downloadBlob } from "./image";

export interface SceneDocument {
  type: "lakar";
  version: 1;
  appState: { canvasBg: string; title?: string };
  elements: LakarElement[];
}

export const serializeScene = (
  elements: readonly LakarElement[],
  canvasBg: string,
  title?: string,
): SceneDocument => ({
  type: "lakar",
  version: 1,
  appState: title ? { canvasBg, title } : { canvasBg },
  elements: JSON.parse(
    JSON.stringify(elements.filter((el) => !el.isDeleted)),
  ) as LakarElement[],
});

export const saveSceneFile = (
  elements: readonly LakarElement[],
  canvasBg: string,
  title: string,
) => {
  const doc = serializeScene(elements, canvasBg, title);
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, `${sanitize(title)}.lakar`);
};

const sanitize = (t: string) =>
  (t.trim() || "scene").replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 60);

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown, fallback: string) =>
  typeof v === "string" ? v : fallback;

const VALID_TYPES = new Set([
  "rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text", "image", "frame",
]);

export const parseSceneFile = (
  raw: string,
): { elements: LakarElement[]; canvasBg: string; title: string | null } => {
  const data = JSON.parse(raw);
  if (
    (data?.type === "lakar" || data?.type === "vellum") &&
    Array.isArray(data.elements)
  ) {
    return {
      elements: data.elements
        .filter((el: { type?: string }) => VALID_TYPES.has(el?.type ?? ""))
        .map(normalizeImported),
      canvasBg: str(data.appState?.canvasBg, DEFAULT_CANVAS_BG),
      title: typeof data.appState?.title === "string" ? data.appState.title : null,
    };
  }
  if (data?.type === "excalidraw" && Array.isArray(data.elements)) {
    const files = (data.files ?? {}) as Record<
      string,
      { dataURL?: string } | undefined
    >;
    return {
      elements: data.elements
        .filter(
          (el: { type?: string; isDeleted?: boolean }) =>
            VALID_TYPES.has(el?.type ?? "") && !el?.isDeleted,
        )
        .map((el: Record<string, unknown>) => fromExcalidraw(el, files))
        .filter(
          (el: LakarElement) => el.type !== "image" || el.dataURL,
        ),
      canvasBg: str(data.appState?.viewBackgroundColor, DEFAULT_CANVAS_BG),
      title: typeof data.appState?.name === "string" ? data.appState.name : null,
    };
  }
  throw new Error("Not an Lakar or Excalidraw file");
};

const normalizeImported = (el: Record<string, unknown>): LakarElement => {
  const base = {
    id: str(el.id, newElementId()),
    type: el.type as LakarElement["type"],
    x: num(el.x, 0),
    y: num(el.y, 0),
    width: num(el.width, 0),
    height: num(el.height, 0),
    angle: num(el.angle, 0),
    strokeColor: str(el.strokeColor, "#26241f"),
    backgroundColor: str(el.backgroundColor, "transparent"),
    fillStyle: (["hachure", "cross-hatch", "solid"].includes(el.fillStyle as string)
      ? el.fillStyle
      : "hachure") as LakarElement["fillStyle"],
    strokeWidth: num(el.strokeWidth, 2),
    strokeStyle: (["solid", "dashed", "dotted"].includes(el.strokeStyle as string)
      ? el.strokeStyle
      : "solid") as LakarElement["strokeStyle"],
    roughness: num(el.roughness, 1),
    opacity: num(el.opacity, 100),
    roundEdges: !!el.roundEdges,
    seed: num(el.seed, randomSeed()),
    version: Math.max(1, Math.floor(num(el.version, 1))),
    versionNonce: num(el.versionNonce, newVersionNonce()),
    isDeleted: false,
    groupIds: Array.isArray(el.groupIds) ? (el.groupIds as string[]) : [],
    frameId: typeof el.frameId === "string" && el.frameId ? el.frameId : null,
    link: typeof el.link === "string" ? normalizeLink(el.link) : null,
    locked: !!el.locked,
  };
  if (base.type === "line" || base.type === "arrow") {
    return {
      ...base,
      type: base.type,
      points: sanitizePoints(el.points),
      startArrowhead: arrowhead(el.startArrowhead, "none"),
      endArrowhead: arrowhead(el.endArrowhead, base.type === "arrow" ? "arrow" : "none"),
      startBinding: sanitizeBinding(el.startBinding),
      endBinding: sanitizeBinding(el.endBinding),
    };
  }
  if (base.type === "freedraw") {
    const points = sanitizePoints(el.points);
    const pressures = Array.isArray(el.pressures)
      ? (el.pressures as number[]).slice(0, points.length)
      : [];
    while (pressures.length < points.length) pressures.push(0.5);
    return { ...base, type: "freedraw", points, pressures };
  }
  if (base.type === "text") {
    const rawText = str(el.text, "");
    const t: TextElement = {
      ...base,
      type: "text",
      text: rawText,
      fontSize: num(el.fontSize, 20),
      fontFamily: (["hand", "normal", "code"].includes(el.fontFamily as string)
        ? el.fontFamily
        : "hand") as FontFamily,
      textAlign: (["left", "center", "right"].includes(el.textAlign as string)
        ? el.textAlign
        : "left") as TextElement["textAlign"],
      lineHeight: num(el.lineHeight, TEXT_LINE_HEIGHT),
      containerId:
        typeof el.containerId === "string" && el.containerId ? el.containerId : null,
      originalText: str(el.originalText, rawText),
    };
    refreshTextDimensions(t);
    return t;
  }
  if (base.type === "image") {
    return {
      ...base,
      type: "image",
      dataURL: str(el.dataURL, ""),
    };
  }
  if (base.type === "frame") {
    return {
      ...base,
      type: "frame",
      name: str(el.name, "Frame"),
      angle: 0,
      frameId: null,
    };
  }
  return base as LakarElement;
};

const sanitizeBinding = (v: unknown): PointBinding | null => {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (typeof b.elementId !== "string" || !b.elementId) return null;
  return {
    elementId: b.elementId,
    fx: clamp(num(b.fx, 0), -0.5, 0.5),
    fy: clamp(num(b.fy, 0), -0.5, 0.5),
    gap: clamp(num(b.gap, 4), 0, 64),
  };
};

const sanitizePoints = (v: unknown): [number, number][] => {
  if (!Array.isArray(v)) return [[0, 0], [1, 1]];
  const pts = v
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => [num(p[0], 0), num(p[1], 0)] as [number, number]);
  return pts.length >= 1 ? pts : [[0, 0], [1, 1]];
};

const arrowhead = (
  v: unknown,
  fallback: "none" | "arrow" | "bar" | "dot",
): "none" | "arrow" | "bar" | "dot" =>
  (["none", "arrow", "bar", "dot"].includes(v as string)
    ? v
    : fallback) as "none" | "arrow" | "bar" | "dot";

const EXCALIDRAW_FONT_TO_LAKAR: Record<number, FontFamily> = {
  1: "hand",
  2: "normal",
  3: "code",
  5: "hand",
  6: "normal",
  7: "normal",
  8: "code",
};

const fromExcalidraw = (
  el: Record<string, unknown>,
  files: Record<string, { dataURL?: string } | undefined> = {},
): LakarElement => {
  const mapped: Record<string, unknown> = {
    ...el,
    roundEdges: !!(el.roundness || (el.strokeSharpness as string) === "round"),
  };
  if (el.type === "text") {
    mapped.fontFamily =
      EXCALIDRAW_FONT_TO_LAKAR[num(el.fontFamily, 1)] ?? "hand";
  }
  if (el.type === "image") {
    mapped.dataURL = files[str(el.fileId, "")]?.dataURL ?? "";
  }
  if (el.startArrowhead == null) mapped.startArrowhead = "none";
  if (el.endArrowhead == null && el.type === "arrow") mapped.endArrowhead = "arrow";
  if (el.startArrowhead === "triangle") mapped.startArrowhead = "arrow";
  if (el.endArrowhead === "triangle") mapped.endArrowhead = "arrow";
  return normalizeImported(mapped);
};

const LAKAR_FONT_TO_EXCALIDRAW: Record<FontFamily, number> = {
  hand: 1,
  normal: 2,
  code: 3,
};

export const exportExcalidrawFile = (
  elements: readonly LakarElement[],
  canvasBg: string,
  title: string,
) => {
  const live = elements.filter((el) => !el.isDeleted);
  const boundTextByContainer = new Map<string, string>();
  for (const el of live) {
    if (el.type === "text" && el.containerId) {
      boundTextByContainer.set(el.containerId, el.id);
    }
  }
  const boundArrowsByShape = new Map<string, string[]>();
  const addBoundArrow = (shapeId: string, arrowId: string) => {
    const list = boundArrowsByShape.get(shapeId);
    if (list) list.push(arrowId);
    else boundArrowsByShape.set(shapeId, [arrowId]);
  };
  for (const el of live) {
    if (!isArrowElement(el)) continue;
    if (el.startBinding) addBoundArrow(el.startBinding.elementId, el.id);
    if (el.endBinding) addBoundArrow(el.endBinding.elementId, el.id);
  }
  const boundElementsFor = (id: string) => {
    const out: { type: string; id: string }[] = [];
    const text = boundTextByContainer.get(id);
    if (text) out.push({ type: "text", id: text });
    for (const arrowId of boundArrowsByShape.get(id) ?? []) {
      out.push({ type: "arrow", id: arrowId });
    }
    return out.length ? out : null;
  };
  const files: Record<string, unknown> = {};
  const converted = live
    .map((el) => {
      const base: Record<string, unknown> = {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: Math.abs(el.width),
        height: Math.abs(el.height),
        angle: el.angle,
        strokeColor: el.strokeColor,
        backgroundColor: el.backgroundColor,
        fillStyle: el.fillStyle,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        roughness: el.roughness,
        opacity: el.opacity,
        groupIds: el.groupIds,
        frameId: el.frameId ?? null,
        roundness: el.roundEdges
          ? el.type === "rectangle"
            ? { type: 3 }
            : { type: 2 }
          : null,
        seed: el.seed,
        version: 1,
        versionNonce: randomSeed(),
        isDeleted: false,
        boundElements: boundElementsFor(el.id),
        updated: Date.now(),
        link: el.link && !isSceneLink(el.link) ? el.link : null,
        locked: el.locked,
      };
      if (isLinearLike(el)) {
        base.points = el.points;
        base.lastCommittedPoint = null;
        if (el.type !== "freedraw") {
          base.startBinding = el.startBinding
            ? {
                elementId: el.startBinding.elementId,
                focus: 0,
                gap: el.startBinding.gap,
              }
            : null;
          base.endBinding = el.endBinding
            ? {
                elementId: el.endBinding.elementId,
                focus: 0,
                gap: el.endBinding.gap,
              }
            : null;
          base.startArrowhead = el.startArrowhead === "none" ? null : el.startArrowhead;
          base.endArrowhead = el.endArrowhead === "none" ? null : el.endArrowhead;
        } else {
          base.pressures = el.pressures;
          base.simulatePressure = el.pressures.every((p) => p === 0.5);
        }
      }
      if (el.type === "text") {
        base.text = el.text;
        base.fontSize = el.fontSize;
        base.fontFamily = LAKAR_FONT_TO_EXCALIDRAW[el.fontFamily];
        base.textAlign = el.textAlign;
        base.verticalAlign = el.containerId ? "middle" : "top";
        base.containerId = el.containerId;
        base.originalText = el.originalText ?? el.text;
        base.autoResize = !el.containerId;
        base.lineHeight = el.lineHeight;
      }
      if (el.type === "frame") {
        base.name = el.name;
        base.frameId = null;
      }
      if (el.type === "image") {
        const fileId = el.id;
        const mimeType = el.dataURL.slice(5, el.dataURL.indexOf(";")) || "image/png";
        files[fileId] = {
          mimeType,
          id: fileId,
          dataURL: el.dataURL,
          created: Date.now(),
        };
        base.fileId = fileId;
        base.status = "saved";
        base.scale = [1, 1];
        base.crop = null;
      }
      return base;
    });

  const doc = {
    type: "excalidraw",
    version: 2,
    source: "lakar",
    elements: converted,
    appState: {
      gridSize: null,
      viewBackgroundColor: canvasBg,
    },
    files,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, `${sanitize(title)}.excalidraw`);
};

export const openSceneFile = (): Promise<{
  elements: LakarElement[];
  canvasBg: string;
  filename: string;
} | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".lakar,.vellum,.excalidraw,.json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        const parsed = parseSceneFile(text);
        const regrouped = new Map<string, string>();
        for (const el of parsed.elements) {
          el.groupIds = el.groupIds.map((g) => {
            if (!regrouped.has(g)) regrouped.set(g, nanoid(10));
            return regrouped.get(g)!;
          });
        }
        resolve({ ...parsed, filename: file.name.replace(/\.[^.]+$/, "") });
      } catch {
        resolve(null);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
