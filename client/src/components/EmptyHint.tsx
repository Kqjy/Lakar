import { useStore } from "../store";
import { GitBranch, Network, Lightbulb } from "lucide-react";
import { insertStarter } from "../starters";

export const EmptyHint = () => {
  const sceneNonce = useStore((s) => s.sceneNonce);
  const elements = useStore((s) => s.elements);
  const editingTextId = useStore((s) => s.editingTextId);
  void sceneNonce;

  if (editingTextId || elements.some((el) => !el.isDeleted)) return null;

  const touch = window.matchMedia("(pointer: coarse)").matches;

  return (
    <div className="empty-hint">
      <span className="hand">This page is yours</span>
      <p className="starter-intro">Start with an example, or sketch your own idea.</p>
      <div className="starter-cards">
        {([
          ["flowchart", "Flowchart", "Map a process", GitBranch],
          ["system", "System diagram", "Connect the pieces", Network],
          ["brainstorm", "Brainstorming", "Explore an idea", Lightbulb],
        ] as const).map(([kind, title, description, Icon]) => (
          <button className="starter-card" key={kind} onClick={() => insertStarter(kind)}>
            <Icon size={24} aria-hidden="true" />
            <strong>{title}</strong><span>{description}</span>
          </button>
        ))}
      </div>
      <div className="sub">
        {touch ? (
          <>
            Pick a shape from the toolbar below, then drag on the canvas.
            <br />
            Double-tap anywhere to write. Drag with two fingers to pan.
          </>
        ) : (
          <>
            Pick a shape from the toolbar, or press <kbd>R</kbd> and drag.
            <br />
            Double-click anywhere to write. Hold <kbd>Space</kbd> to pan.
          </>
        )}
      </div>
    </div>
  );
};
