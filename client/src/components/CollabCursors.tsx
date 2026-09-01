import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../store";
import { presence, IDLE_MS } from "../collab/presence";
import { centerOnPoint } from "../interaction/view";
import type { PeerPointer } from "../types";

const TOOL_LABEL: Partial<Record<string, string>> = {
  rectangle: "drawing",
  diamond: "drawing",
  ellipse: "drawing",
  arrow: "drawing",
  line: "drawing",
  freedraw: "sketching",
  text: "typing",
  frame: "framing",
  eraser: "erasing",
  laser: "pointing",
  bucket: "filling",
};

const EDGE_INSET = 22;

const activityOf = (p: PeerPointer, idle: boolean) => {
  if (p.away) return "away";
  if (idle) return "idle";
  return TOOL_LABEL[p.tool];
};

export const CollabCursors = () => {
  const pointers = useSyncExternalStore(presence.subscribe, presence.getPointers);
  const viewport = useStore((s) => s.viewport);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!pointers.length) return;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [pointers.length]);

  return (
    <div className="collab-cursors" ref={rootRef}>
      {pointers.map((p) => {
        const left = (p.x - viewport.scrollX) * viewport.zoom;
        const top = (p.y - viewport.scrollY) * viewport.zoom;
        const idle = !p.away && now - p.updatedAt > IDLE_MS;
        const activity = activityOf(p, idle);
        const offscreen =
          size.w > 0 &&
          (left < 0 || top < 0 || left > size.w || top > size.h);

        if (offscreen) {
          const cx = size.w / 2;
          const cy = size.h / 2;
          const dx = left - cx;
          const dy = top - cy;
          const scale = Math.min(
            Math.abs(dx) < 0.01 ? Infinity : (cx - EDGE_INSET) / Math.abs(dx),
            Math.abs(dy) < 0.01 ? Infinity : (cy - EDGE_INSET) / Math.abs(dy),
          );
          const ex = cx + dx * scale;
          const ey = cy + dy * scale;
          return (
            <button
              key={p.id}
              type="button"
              className={`collab-offscreen ${p.away ? "away" : ""}`}
              style={{
                transform: `translate3d(${ex}px, ${ey}px, 0) translate(-50%, -50%)`,
                background: p.color,
              }}
              title={`${p.name} is off-screen — click to jump there`}
              onClick={() => centerOnPoint({ x: p.x, y: p.y })}
            >
              <span
                className="collab-offscreen-arrow"
                style={{
                  transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
                }}
              />
              {p.name}
            </button>
          );
        }

        return (
          <div
            key={p.id}
            className={`collab-cursor ${p.away ? "away" : idle ? "idle" : ""}`}
            style={{ transform: `translate3d(${left}px, ${top}px, 0)` }}
          >
            <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
              <path
                d="M2.5 1.6 L15.6 12.1 L9.4 12.8 L12.2 19.4 L9.3 20.6 L6.6 14 L2.4 18.2 Z"
                fill={p.color}
                stroke="#ffffff"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span className="collab-cursor-label" style={{ background: p.color }}>
              {p.name}
              {activity && <em>{activity}</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
};
