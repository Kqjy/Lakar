import { useSyncExternalStore } from "react";
import { useStore } from "../store";
import { presence } from "../collab/presence";

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
};

export const CollabCursors = () => {
  const pointers = useSyncExternalStore(presence.subscribe, presence.getPointers);
  const viewport = useStore((s) => s.viewport);

  if (!pointers.length) return null;

  return (
    <div className="collab-cursors">
      {pointers.map((p) => {
        const left = (p.x - viewport.scrollX) * viewport.zoom;
        const top = (p.y - viewport.scrollY) * viewport.zoom;
        const activity = TOOL_LABEL[p.tool];
        return (
          <div
            key={p.id}
            className="collab-cursor"
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
