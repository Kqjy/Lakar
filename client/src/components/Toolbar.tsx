import { useEffect, useRef, useState } from "react";
import {
  Backpack,
  Ellipsis,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Minus,
  MousePointer2,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Square,
  Type,
  Wand,
} from "lucide-react";
import { useStore } from "../store";
import type { ToolType } from "../types";
import { insertImageFromPicker } from "../interaction/images";

const TOOLS: { tool: ToolType; icon: React.ReactNode; label: string; hint: string; title: string }[] = [
  { tool: "selection", icon: <MousePointer2 size={18} />, label: "Select", hint: "1", title: "Select — V or 1" },
  { tool: "hand", icon: <Hand size={18} />, label: "Hand (pan)", hint: "H", title: "Hand (pan) — H" },
  { tool: "rectangle", icon: <Square size={18} />, label: "Rectangle", hint: "2", title: "Rectangle — R or 2" },
  { tool: "diamond", icon: <Diamond size={18} />, label: "Diamond", hint: "3", title: "Diamond — D or 3" },
  { tool: "ellipse", icon: <Circle size={18} />, label: "Ellipse", hint: "4", title: "Ellipse — O or 4" },
  { tool: "arrow", icon: <MoveUpRight size={18} />, label: "Arrow", hint: "5", title: "Arrow — A or 5" },
  { tool: "line", icon: <Minus size={18} />, label: "Line", hint: "6", title: "Line — L or 6" },
  { tool: "freedraw", icon: <Pencil size={18} />, label: "Draw", hint: "7", title: "Draw — P or 7" },
  { tool: "text", icon: <Type size={18} />, label: "Text", hint: "8", title: "Text — T or 8" },
  { tool: "frame", icon: <Frame size={18} />, label: "Frame", hint: "F", title: "Frame — F" },
  { tool: "laser", icon: <Wand size={18} />, label: "Laser pointer", hint: "K", title: "Laser pointer — K" },
  { tool: "bucket", icon: <PaintBucket size={18} />, label: "Fill", hint: "B", title: "Fill — B" },
  { tool: "eraser", icon: <Eraser size={18} />, label: "Eraser", hint: "0", title: "Eraser — E or 0" },
];

export const Toolbar = () => {
  const activeTool = useStore((s) => s.activeTool);
  const toolLocked = useStore((s) => s.toolLocked);
  const setTool = useStore((s) => s.setTool);
  const setToolLocked = useStore((s) => s.setToolLocked);
  const satchelOpen = useStore((s) => s.satchelOpen);
  const setSatchelOpen = useStore((s) => s.setSatchelOpen);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const primary = ["selection", "hand", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "eraser"];
  const secondary = TOOLS.filter(({ tool }) => !primary.includes(tool));
  const activeSecondary = secondary.find(({ tool }) => tool === activeTool);

  useEffect(() => {
    if (!moreOpen) return;
    moreRef.current?.querySelector<HTMLButtonElement>(".more-panel button")?.focus();
    const close = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  const pick = (action: () => void) => {
    action();
    setMoreOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="island toolbar" role="toolbar" aria-label="Drawing tools">
      {TOOLS.filter(({ tool }) => primary.includes(tool)).map(({ tool, icon, label, hint, title }) => (
        <button key={tool} className={`tool-btn ${activeTool === tool ? "active" : ""}`}
          title={title} aria-label={label} aria-pressed={activeTool === tool} onClick={() => setTool(tool)}>
          {icon}<span className="key-hint">{hint}</span>
        </button>
      ))}
      <div className="toolbar-divider" />
      <div className="more-tools" ref={moreRef} onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); setMoreOpen(false); triggerRef.current?.focus(); }
      }}>
        <button ref={triggerRef} className={`tool-btn more-trigger ${activeSecondary || moreOpen ? "active" : ""}`}
          aria-label={activeSecondary ? `More tools — ${activeSecondary.label} selected` : "More tools"}
          aria-expanded={moreOpen} aria-controls="more-tools-panel" onClick={() => setMoreOpen(!moreOpen)}>
          {activeSecondary?.icon ?? <Ellipsis size={18} />}<span>More</span>
        </button>
        {moreOpen && <div className="island more-panel" id="more-tools-panel" role="group" aria-label="More tools">
          <div className="menu-heading">More tools</div>
          {secondary.map(({ tool, icon, label, hint, title }) => (
            <button key={tool} className="menu-item" title={title} aria-pressed={activeTool === tool}
              onClick={() => pick(() => setTool(tool))}>
              {icon}{label}<span className="shortcut">{hint}</span>
            </button>
          ))}
          <button className="menu-item" onClick={() => pick(() => { void insertImageFromPicker(); })}>
            <ImageIcon size={18} />Insert image<span className="shortcut">9</span>
          </button>
          <button className="menu-item" aria-pressed={satchelOpen} onClick={() => pick(() => setSatchelOpen(!satchelOpen))}>
            <Backpack size={18} />Shapes & icons<span className="shortcut">S</span>
          </button>
          <div className="menu-sep" />
          <button className="menu-item" aria-pressed={toolLocked} onClick={() => setToolLocked(!toolLocked)}>
            {toolLocked ? <Lock size={15} /> : <LockOpen size={15} />}Keep tool active<span className="shortcut">Q</span>
          </button>
        </div>}
      </div>
    </div>
  );
};
