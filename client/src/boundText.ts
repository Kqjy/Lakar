import type {
  LakarElement,
  Point,
  TextElement,
  TextContainerElement,
  LinearElement,
} from "./types";
import { isBoundText, isTextContainer } from "./types";
import { getElementBounds, mutateElement } from "./elements";
import { measureText, wrapText } from "./text/measure";
import { pointInBounds, rotatePoint } from "./math";

export const BOUND_PAD = 10;

export const getBoundTextCenterY = (
  container: TextContainerElement,
  height: number,
  verticalAlign: TextElement["verticalAlign"],
) => {
  const top = Math.min(container.y, container.y + container.height);
  const bottom = Math.max(container.y, container.y + container.height);
  if (verticalAlign === "top") return top + BOUND_PAD + height / 2;
  if (verticalAlign === "bottom") return bottom - BOUND_PAD - height / 2;
  return (top + bottom) / 2;
};

export const getBoundText = (
  elements: readonly LakarElement[],
  containerId: string,
): TextElement | undefined =>
  elements.find(
    (el): el is TextElement =>
      !el.isDeleted && isBoundText(el) && el.containerId === containerId,
  );

export const getContainerOf = (
  elements: readonly LakarElement[],
  textEl: TextElement,
): TextContainerElement | undefined => {
  if (!textEl.containerId) return undefined;
  const el = elements.find(
    (e) => e.id === textEl.containerId && !e.isDeleted,
  );
  return el && isTextContainer(el) ? el : undefined;
};

export const getLooseTextInside = (
  elements: readonly LakarElement[],
  host: LakarElement,
  near?: Point,
): TextElement | undefined => {
  const bounds = getElementBounds(host);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  let best: TextElement | undefined;
  let bestDistance = Infinity;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || el.locked || el.type !== "text" || el.containerId) {
      continue;
    }
    const tb = getElementBounds(el);
    const tc = { x: (tb.minX + tb.maxX) / 2, y: (tb.minY + tb.maxY) / 2 };
    const p = host.angle ? rotatePoint(tc, center, -host.angle) : tc;
    if (!pointInBounds(p, bounds)) continue;
    if (!near) return el;
    const d = Math.hypot(tc.x - near.x, tc.y - near.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = el;
    }
  }
  return best;
};

export const syncBoundText = (
  elements: readonly LakarElement[],
  container: LakarElement,
) => {
  if (!isTextContainer(container)) return;
  const textEl = getBoundText(elements, container.id);
  if (!textEl) return;

  if (container.type === "arrow" || container.type === "line") {
    const raw = textEl.originalText ?? textEl.text;
    const metrics = measureText(raw, textEl.fontFamily, textEl.fontSize, textEl.lineHeight);
    const center = getArrowLabelCenter(container);
    mutateElement(textEl, {
      text: raw, originalText: raw, width: metrics.width, height: metrics.height,
      x: center.x - metrics.width / 2, y: center.y - metrics.height / 2, angle: 0,
    });
    return;
  }

  const maxW = Math.max(30, Math.abs(container.width) - BOUND_PAD * 2);
  const raw = textEl.originalText ?? textEl.text;
  const wrapped = wrapText(raw, textEl.fontFamily, textEl.fontSize, maxW);
  const metrics = measureText(
    wrapped,
    textEl.fontFamily,
    textEl.fontSize,
    textEl.lineHeight,
  );

  const neededHeight = metrics.height + BOUND_PAD * 2;
  if (neededHeight > Math.abs(container.height)) {
    mutateElement(container, { height: neededHeight });
  }

  const cx = container.x + container.width / 2;
  const cy = container.y + container.height / 2;
  const innerLeft = Math.min(container.x, container.x + container.width) + BOUND_PAD;
  const innerRight = Math.max(container.x, container.x + container.width) - BOUND_PAD;
  let blockX: number;
  if (textEl.textAlign === "left") blockX = innerLeft;
  else if (textEl.textAlign === "right") blockX = innerRight - metrics.width;
  else blockX = cx - metrics.width / 2;

  const center = rotatePoint(
    {
      x: blockX + metrics.width / 2,
      y: getBoundTextCenterY(container, metrics.height, textEl.verticalAlign),
    },
    { x: cx, y: cy },
    container.angle,
  );
  mutateElement(textEl, {
    text: wrapped,
    originalText: raw,
    width: metrics.width,
    height: metrics.height,
    x: center.x - metrics.width / 2,
    y: center.y - metrics.height / 2,
    angle: container.angle,
  });
};

export const syncBoundTextsAfterMutation = (
  elements: readonly LakarElement[],
  mutated: Iterable<LakarElement>,
) => {
  for (const el of mutated) {
    if (isTextContainer(el)) syncBoundText(elements, el);
  }
};

export const expandWithBoundTexts = (
  elements: readonly LakarElement[],
  ids: Iterable<string>,
): Set<string> => {
  const set = new Set(ids);
  for (const el of elements) {
    if (el.isDeleted || !set.has(el.id) || !isTextContainer(el)) continue;
    const bound = getBoundText(elements, el.id);
    if (bound) set.add(bound.id);
  }
  return set;
};

// Halfway along the path, including arrows with several segments.
export const getArrowLabelCenter = (arrow: LinearElement): Point => {
  const points = arrow.points.length ? arrow.points : [[0, 0]];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let [x, y] = points[0];
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (remaining <= length && length > 0) {
      const ratio = remaining / length;
      x = points[i][0] + (points[i + 1][0] - points[i][0]) * ratio;
      y = points[i][1] + (points[i + 1][1] - points[i][1]) * ratio;
      break;
    }
    remaining -= length;
  }
  const bounds = getElementBounds(arrow);
  return rotatePoint({ x: arrow.x + x, y: arrow.y + y }, {
    x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2,
  }, arrow.angle);
};
