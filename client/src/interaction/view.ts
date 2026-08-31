import { getSelectedElements, getVisibleElements, useStore } from "../store";
import { getCommonBounds, getRotatedBounds } from "../elements";
import { clamp } from "../math";
import { MAX_ZOOM, MIN_ZOOM } from "../constants";
import type { Bounds, Point } from "../types";

const viewportSize = () => ({
  w: window.innerWidth,
  h: window.innerHeight,
});

export const zoomToLevel = (zoom: number) => {
  const s = useStore.getState();
  const { w, h } = viewportSize();
  s.zoomAt(clamp(zoom, MIN_ZOOM, MAX_ZOOM), w / 2, h / 2);
};

export const zoomIn = () => {
  const { viewport } = useStore.getState();
  zoomToLevel(nextStep(viewport.zoom, 1));
};

export const zoomOut = () => {
  const { viewport } = useStore.getState();
  zoomToLevel(nextStep(viewport.zoom, -1));
};

const nextStep = (zoom: number, dir: 1 | -1) => {
  const step = 0.1;
  const next = Math.round((zoom + dir * step * Math.max(1, Math.floor(zoom))) * 100) / 100;
  return next;
};

export const zoomTo100 = () => zoomToLevel(1);

export const fitToBounds = (
  bounds: Bounds,
  margin = 1.15,
  maxZoom = MAX_ZOOM,
) => {
  const s = useStore.getState();
  const { w, h } = viewportSize();
  const bw = Math.max(bounds.maxX - bounds.minX, 10);
  const bh = Math.max(bounds.maxY - bounds.minY, 10);
  const zoom = clamp(
    Math.min(w / (bw * margin), h / (bh * margin), maxZoom),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  s.setViewport({
    zoom,
    scrollX: bounds.minX - (w / zoom - bw) / 2,
    scrollY: bounds.minY - (h / zoom - bh) / 2,
  });
};

export const zoomToFit = (selectionOnly = false) => {
  const s = useStore.getState();
  const els = selectionOnly ? getSelectedElements() : getVisibleElements();
  if (!els.length) {
    s.setViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
    return;
  }
  fitToBounds(getCommonBounds(els), 1.15, 1.5);
};

export const revealElement = (id: string, select = true) => {
  const s = useStore.getState();
  const el = s.elements.find((e) => e.id === id && !e.isDeleted);
  if (!el) return;
  const target =
    el.type === "text" && el.containerId
      ? s.elements.find((e) => e.id === el.containerId && !e.isDeleted) ?? el
      : el;
  const b = getRotatedBounds(target);
  const { w, h } = viewportSize();
  const zoom = clamp(s.viewport.zoom, 0.5, 2);
  s.setViewport({
    zoom,
    scrollX: (b.minX + b.maxX) / 2 - w / 2 / zoom,
    scrollY: (b.minY + b.maxY) / 2 - h / 2 / zoom,
  });
  if (select && !target.locked) {
    s.setSelectedIds([target.id]);
    if (s.activeTool !== "selection") s.setTool("selection");
  }
};

export const resetScroll = () => {
  useStore.getState().setViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
};

export const centerOnPoint = (point: Point, zoom?: number) => {
  const s = useStore.getState();
  const { w, h } = viewportSize();
  const next = clamp(zoom ?? s.viewport.zoom, MIN_ZOOM, MAX_ZOOM);
  s.setViewport({
    zoom: next,
    scrollX: point.x - w / 2 / next,
    scrollY: point.y - h / 2 / next,
  });
};
