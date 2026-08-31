import {
  Backpack,
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
  { tool: "eraser", icon: <Eraser size={18} />, label: "Eraser", hint: "0", title: "Eraser — E or 0" },
];

export const Toolbar = () => {
  const activeTool = useStore((s) => s.activeTool);
  const toolLocked = useStore((s) => s.toolLocked);
  const setTool = useStore((s) => s.setTool);
  const setToolLocked = useStore((s) => s.setToolLocked);
  const satchelOpen = useStore((s) => s.satchelOpen);
  const setSatchelOpen = useStore((s) => s.setSatchelOpen);

  return (
    <div className="island toolbar" role="toolbar" aria-label="Drawing tools">
      <button
        className={`tool-btn tool-lock ${toolLocked ? "active" : ""}`}
        title={
          toolLocked
            ? "Keep tool active after drawing — on (Q)"
            : "Keep tool active after drawing — off (Q)"
        }
        aria-pressed={toolLocked}
        onClick={() => setToolLocked(!toolLocked)}
      >
        {toolLocked ? <Lock size={15} /> : <LockOpen size={15} />}
      </button>
      <div className="toolbar-divider" />
      {TOOLS.map(({ tool, icon, hint, title }) => (
        <button
          key={tool}
          className={`tool-btn ${activeTool === tool ? "active" : ""}`}
          title={title}
          aria-pressed={activeTool === tool}
          onClick={() => setTool(tool)}
        >
          {icon}
          <span className="key-hint">{hint}</span>
        </button>
      ))}
      <button
        className="tool-btn"
        title="Insert image — 9"
        onClick={() => insertImageFromPicker()}
      >
        <ImageIcon size={18} />
        <span className="key-hint">9</span>
      </button>
      <div className="toolbar-divider" />
      <button
        className={`tool-btn ${satchelOpen ? "active" : ""}`}
        title="Satchel — ready-made shapes and icons (S)"
        aria-pressed={satchelOpen}
        onClick={() => setSatchelOpen(!satchelOpen)}
      >
        <Backpack size={18} />
        <span className="key-hint">S</span>
      </button>
    </div>
  );
};
