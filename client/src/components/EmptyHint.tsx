import { useStore } from "../store";

export const EmptyHint = () => {
  const sceneNonce = useStore((s) => s.sceneNonce);
  const elements = useStore((s) => s.elements);
  const editingTextId = useStore((s) => s.editingTextId);
  void sceneNonce;

  if (editingTextId || elements.some((el) => !el.isDeleted)) return null;

  return (
    <div className="empty-hint">
      <span className="hand">This page is yours</span>
      <div className="sub">
        Pick a shape from the toolbar, or press <kbd>R</kbd> and drag.
        <br />
        Double-click anywhere to write. Hold <kbd>Space</kbd> to pan.
      </div>
    </div>
  );
};
