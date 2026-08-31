import { Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { zoomIn, zoomOut, zoomTo100, zoomToFit } from "../interaction/view";
import { history } from "../history";

export const ZoomBar = () => {
  const zoom = useStore((s) => s.viewport.zoom);
  const [, force] = useState(0);

  useEffect(() => history.subscribe(() => force((n) => n + 1)), []);

  return (
    <div className="zoom-bar">
      <div className="island zoom-island">
        <button className="icon-btn" title="Zoom out — Ctrl+-" onClick={zoomOut}>
          <Minus size={15} />
        </button>
        <button
          className="zoom-pct"
          title="Reset zoom — double-click to fit"
          onClick={zoomTo100}
          onDoubleClick={() => zoomToFit()}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" title="Zoom in — Ctrl++" onClick={zoomIn}>
          <Plus size={15} />
        </button>
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
