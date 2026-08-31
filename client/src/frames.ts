import type { FrameElement, LakarElement, Point } from "./types";
import { isBoundText, isFrameElement } from "./types";
import { getElementBounds, getElementCenter, mutateElement } from "./elements";

export const getLiveFrames = (
  elements: readonly LakarElement[],
): FrameElement[] =>
  elements.filter(
    (el): el is FrameElement => isFrameElement(el) && !el.isDeleted,
  );

export const getFrameChildren = (
  elements: readonly LakarElement[],
  frameId: string,
): LakarElement[] =>
  elements.filter((el) => !el.isDeleted && el.frameId === frameId);

export const expandWithFrameMembers = (
  elements: readonly LakarElement[],
  ids: Iterable<string>,
): Set<string> => {
  const out = new Set(ids);
  for (const el of elements) {
    if (isFrameElement(el) && !el.isDeleted && out.has(el.id)) {
      for (const child of elements) {
        if (!child.isDeleted && child.frameId === el.id) out.add(child.id);
      }
    }
  }
  return out;
};

const frameAtPoint = (
  frames: readonly FrameElement[],
  p: Point,
): FrameElement | null => {
  for (let i = frames.length - 1; i >= 0; i--) {
    const b = getElementBounds(frames[i]);
    if (p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY) {
      return frames[i];
    }
  }
  return null;
};

export const refreshFrameMembership = (
  elements: readonly LakarElement[],
): boolean => {
  const frames = getLiveFrames(elements);
  const byId = new Map(elements.map((el) => [el.id, el]));
  let changed = false;
  const setFrameId = (el: LakarElement, next: string | null) => {
    if ((el.frameId ?? null) !== next) {
      mutateElement(el, { frameId: next } as Partial<LakarElement>);
      changed = true;
    }
  };
  for (const el of elements) {
    if (el.isDeleted) continue;
    if (isFrameElement(el)) {
      setFrameId(el, null);
      continue;
    }
    if (isBoundText(el)) {
      const container = el.containerId ? byId.get(el.containerId) : undefined;
      setFrameId(el, container && !container.isDeleted ? (container.frameId ?? null) : null);
      continue;
    }
    const target = frames.length
      ? frameAtPoint(frames, getElementCenter(el))
      : null;
    setFrameId(el, target ? target.id : null);
  }
  return changed;
};

export const nextFrameName = (elements: readonly LakarElement[]): string => {
  let n = 0;
  for (const el of getLiveFrames(elements)) {
    const m = /^Frame (\d+)$/.exec(el.name);
    n = Math.max(n, m ? Number(m[1]) : 0);
  }
  return `Frame ${n + 1}`;
};
