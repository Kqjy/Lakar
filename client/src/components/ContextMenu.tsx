import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSelectedElements, useStore } from "../store";
import {
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  groupSelected,
  reorderSelected,
  selectAll,
  toggleLockSelected,
  ungroupSelected,
} from "../interaction/actions";
import { pasteSmart } from "../interaction/images";
import { zoomToFit } from "../interaction/view";
import { history } from "../history";
import { satchel } from "../satchel/store";

export const ContextMenu = () => {
  const contextMenu = useStore((s) => s.contextMenu);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const gridSize = useStore((s) => s.gridSize);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!contextMenu || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(contextMenu.x, window.innerWidth - rect.width - 8);
    const y = Math.min(contextMenu.y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  const selected = getSelectedElements();
  const anySelection = selected.length > 0;
  const close = () => setContextMenu(null);
  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };

  return (
    <div
      ref={ref}
      className="menu-pop context-menu"
      style={{
        left: pos?.x ?? contextMenu.x,
        top: pos?.y ?? contextMenu.y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {anySelection ? (
        <>
          <button className="menu-item" onClick={run(cutSelected)}>
            Cut <span className="shortcut">Ctrl+X</span>
          </button>
          <button className="menu-item" onClick={run(copySelected)}>
            Copy <span className="shortcut">Ctrl+C</span>
          </button>
          <button className="menu-item" onClick={run(() => duplicateSelected())}>
            Duplicate <span className="shortcut">Ctrl+D</span>
          </button>
          <div className="menu-sep" />
          {selected.length > 1 && (
            <button className="menu-item" onClick={run(groupSelected)}>
              Group <span className="shortcut">Ctrl+G</span>
            </button>
          )}
          {selected.some((el) => el.groupIds.length > 0) && (
            <button className="menu-item" onClick={run(ungroupSelected)}>
              Ungroup <span className="shortcut">Ctrl+Shift+G</span>
            </button>
          )}
          <button className="menu-item" onClick={run(() => reorderSelected("toFront"))}>
            Bring to front <span className="shortcut">Ctrl+Shift+]</span>
          </button>
          <button className="menu-item" onClick={run(() => reorderSelected("toBack"))}>
            Send to back <span className="shortcut">Ctrl+Shift+[</span>
          </button>
          <button className="menu-item" onClick={run(toggleLockSelected)}>
            Lock
          </button>
          {selected.length === 1 && (
            <>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={run(() =>
                  useStore.getState().setLinkEditorId(selected[0].id),
                )}
              >
                {selected[0].link ? "Edit link…" : "Add link…"}
              </button>
            </>
          )}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={run(async () => {
              const item = await satchel.addFromSelection("My shape");
              const s = useStore.getState();
              if (item) {
                s.setSatchelOpen(true);
                s.toast("Added to your satchel", "success");
              } else {
                s.toast("That selection is too big for the satchel", "error");
              }
            })}
          >
            Add to satchel
          </button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={run(deleteSelected)}>
            Delete <span className="shortcut">Del</span>
          </button>
        </>
      ) : (
        <>
          <button className="menu-item" onClick={run(() => pasteSmart(null))}>
            Paste <span className="shortcut">Ctrl+V</span>
          </button>
          <button className="menu-item" onClick={run(selectAll)}>
            Select all <span className="shortcut">Ctrl+A</span>
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={run(() => useStore.getState().setSnapEnabled(!snapEnabled))}
          >
            {snapEnabled ? "✓ Snap to objects" : "Snap to objects"}
            <span className="shortcut">Alt+S</span>
          </button>
          <button
            className="menu-item"
            onClick={run(() =>
              useStore.getState().setGridSize(gridSize ? null : 20),
            )}
          >
            {gridSize ? "✓ Show grid" : "Show grid"}
            <span className="shortcut">Ctrl+'</span>
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={run(() => zoomToFit())}>
            Zoom to fit <span className="shortcut">Shift+1</span>
          </button>
          <button
            className="menu-item"
            onClick={run(() => {
              const s = useStore.getState();
              const unlocked = s.elements.filter((el) => !el.isDeleted && el.locked);
              if (!unlocked.length) return;
              for (const el of unlocked) el.locked = false;
              s.bumpScene();
              history.commit();
              s.toast(`Unlocked ${unlocked.length} element${unlocked.length > 1 ? "s" : ""}`);
            })}
          >
            Unlock all
          </button>
        </>
      )}
    </div>
  );
};
