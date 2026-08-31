import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useStore } from "../store";
import { getSlides, nextSlide, prevSlide, stopPresentation } from "../presentation";

export const PresentBar = () => {
  const presenting = useStore((s) => s.presenting);
  const index = useStore((s) => s.presentIndex);
  const elements = useStore((s) => s.elements);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!presenting) return;
    let timer = window.setTimeout(() => setIdle(true), 2600);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2600);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [presenting]);

  if (!presenting) return null;
  const slides = getSlides(elements);
  const total = slides.length;
  const name = slides[index]?.name ?? "";

  return (
    <div className={`present-bar ${idle ? "idle" : ""}`}>
      <button
        className="present-btn"
        onClick={prevSlide}
        disabled={index === 0}
        title="Previous — ←"
        aria-label="Previous slide"
      >
        <ChevronLeft size={17} />
      </button>
      <span className="present-count">
        {index + 1} / {total}
      </span>
      {name && <span className="present-name">{name}</span>}
      <button
        className="present-btn"
        onClick={nextSlide}
        disabled={index >= total - 1}
        title="Next — →"
        aria-label="Next slide"
      >
        <ChevronRight size={17} />
      </button>
      <div className="present-sep" />
      <button
        className="present-btn"
        onClick={stopPresentation}
        title="Exit — Esc"
        aria-label="Exit presentation"
      >
        <X size={16} />
      </button>
    </div>
  );
};
