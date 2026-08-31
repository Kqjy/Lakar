import type {
  ContainerElement,
  LakarElement,
  Point,
  TextElement,
} from "./types";
import { isBoundText, isContainerElement } from "./types";
import { getElementBounds, mutateElement } from "./elements";
import { measureText, wrapText } from "./text/measure";
import { pointInBounds, rotatePoint } from "./math";

export const BOUND_PAD = 10;

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
): ContainerElement | undefined => {
  if (!textEl.containerId) return undefined;
  const el = elements.find(
    (e) => e.id === textEl.containerId && !e.isDeleted,
  );
  return el && isContainerElement(el) ? el : undefined;
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
  if (!isContainerElement(container)) return;
  const textEl = getBoundText(elements, container.id);
  if (!textEl) return;

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
    { x: blockX + metrics.width / 2, y: cy },
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
    if (isContainerElement(el)) syncBoundText(elements, el);
  }
};

export const expandWithBoundTexts = (
  elements: readonly LakarElement[],
  ids: Iterable<string>,
): Set<string> => {
  const set = new Set(ids);
  for (const el of elements) {
    if (el.isDeleted || !set.has(el.id) || !isContainerElement(el)) continue;
    const bound = getBoundText(elements, el.id);
    if (bound) set.add(bound.id);
  }
  return set;
};
