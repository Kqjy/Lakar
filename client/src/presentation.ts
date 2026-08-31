import type { FrameElement, LakarElement } from "./types";
import { useStore } from "./store";
import { getElementBounds } from "./elements";
import { getLiveFrames } from "./frames";
import { fitToBounds } from "./interaction/view";

export const getSlides = (
  elements: readonly LakarElement[],
): FrameElement[] => getLiveFrames(elements);

export const currentSlide = (): FrameElement | null => {
  const s = useStore.getState();
  const slides = getSlides(s.elements);
  return slides[s.presentIndex] ?? null;
};

export const gotoSlide = (index: number) => {
  const s = useStore.getState();
  const slides = getSlides(s.elements);
  if (!slides.length) return;
  const next = Math.max(0, Math.min(slides.length - 1, index));
  s.setPresentIndex(next);
  fitToBounds(getElementBounds(slides[next]), 1.04);
};

export const nextSlide = () => gotoSlide(useStore.getState().presentIndex + 1);

export const prevSlide = () => gotoSlide(useStore.getState().presentIndex - 1);

export const startPresentation = () => {
  const s = useStore.getState();
  if (!getSlides(s.elements).length) {
    s.toast("Draw a frame first — frames are the slides", "error");
    return;
  }
  s.clearSelection();
  if (s.activeTool !== "selection") s.setTool("selection");
  s.setPresenting(true);
  gotoSlide(0);
};

export const stopPresentation = () => {
  useStore.getState().setPresenting(false);
};

export const presentationElements = (
  elements: readonly LakarElement[],
  frame: FrameElement | null,
): LakarElement[] => {
  if (!frame) return [];
  return elements.filter(
    (el) => !el.isDeleted && el.id !== frame.id && el.frameId === frame.id,
  );
};
