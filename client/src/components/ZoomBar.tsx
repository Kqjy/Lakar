import { Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSelectedElements, useStore } from "../store";
import { zoomIn, zoomOut, zoomToFit, zoomToLevel } from "../interaction/view";
import { history } from "../history";

const ZOOM_PRESETS = [0.5, 1, 2, 4];

export const ZoomBar = () => {
  const zoom = useStore((s) => s.viewport.zoom);
  const hasSelection = useStore((s) => s.selectedIds.size > 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  useEffect(() => history.subscribe(() => force((n) => n + 1)), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const pick = (fn: () => void) => () => {
    fn();
    setMenuOpen(false);
  };

  return (
    <div className="zoom-bar">
      <div className="island zoom-island" ref={menuRef}>
        <button className="icon-btn" title="Zoom out — Ctrl+-" onClick={zoomOut}>
          <Minus size={15} />
        </button>
        <button
          className="zoom-pct"
          title="Zoom options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" title="Zoom in — Ctrl++" onClick={zoomIn}>
          <Plus size={15} />
        </button>
        {menuOpen && (
          <div className="menu-pop zoom-pop" role="menu">
            {ZOOM_PRESETS.map((z) => (
              <button
                key={z}
                className="menu-item"
                onClick={pick(() => zoomToLevel(z))}
              >
                {z * 100}%
                {z === 1 && <span className="shortcut">Ctrl+0</span>}
              </button>
            ))}
            <div className="menu-sep" />
            <button className="menu-item" onClick={pick(() => zoomToFit())}>
              Zoom to fit <span className="shortcut">Shift+1</span>
            </button>
            <button
              className="menu-item"
              disabled={!hasSelection}
              onClick={pick(() => {
                if (getSelectedElements().length) zoomToFit(true);
              })}
            >
              Zoom to selection <span className="shortcut">Shift+2</span>
            </button>
          </div>
        )}
      </div>
      <div className="island zoom-island">
        <button
          className="icon-btn"
          title="Undo — Ctrl+Z"
          onClick={() => history.undo()}
          disabled={!history.canUndo}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-btn"
          title="Redo — Ctrl+Shift+Z"
          onClick={() => history.redo()}
          disabled={!history.canRedo}
        >
          <Redo2 size={15} />
        </button>
      </div>
    </div>
  );
};
