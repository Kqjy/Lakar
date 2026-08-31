import { Eye, Minus, Plus } from "lucide-react";
import { useStore } from "../store";
import { zoomIn, zoomOut, zoomToFit } from "../interaction/view";
import { APP_NAME } from "../constants";

export const ViewerChrome = () => {
  const title = useStore((s) => s.sceneTitle);
  const zoom = useStore((s) => s.viewport.zoom);
  const failed = useStore((s) => s.viewerLoadFailed);

  if (failed) {
    return (
      <div className="viewer-empty">
        <h1>This page is not available</h1>
        <p>
          The link may be incomplete, or the person who shared it has taken it
          down. A {APP_NAME} link only works with the key that comes after the
          <code>#</code> — copy the whole thing.
        </p>
        <a className="viewer-cta" href="/">
          Open {APP_NAME}
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="island viewer-bar">
        <Eye size={15} />
        <span className="viewer-title">{title}</span>
        <span className="viewer-tag">read-only</span>
      </div>
      <div className="island viewer-zoom">
        <button onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <button onClick={() => zoomToFit()} title="Zoom to fit">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
          <Plus size={15} />
        </button>
      </div>
      <a className="viewer-brand" href="/">
        Made with {APP_NAME}
      </a>
    </>
  );
};
