import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileUp,
  FolderOpen,
  HelpCircle,
  Image,
  Menu,
  Moon,
  Sun,
  Trash2,
} from "lucide-react";
import { useStore } from "../store";
import { CANVAS_BACKGROUNDS } from "../constants";
import { themedColor } from "../colors";
import { saveSceneFile, exportExcalidrawFile } from "../export/json";
import { syncManager } from "../sync/manager";
import { openFromFile } from "../interaction/fileOps";

export const TopLeft = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const canvasBg = useStore((s) => s.canvasBg);
  const setCanvasBg = useStore((s) => s.setCanvasBg);
  const sceneTitle = useStore((s) => s.sceneTitle);
  const sceneId = useStore((s) => s.sceneId);
  const syncStatus = useStore((s) => s.syncStatus);
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const [titleDraft, setTitleDraft] = useState(sceneTitle);

  useEffect(() => setTitleDraft(sceneTitle), [sceneTitle]);

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

  const commitTitle = () => {
    const title = titleDraft.trim() || "Untitled scene";
    setTitleDraft(title);
    if (title === sceneTitle) return;
    if (sceneId) void syncManager.renameScene(sceneId, title);
    else useStore.getState().setSceneTitle(title);
  };

  const openFile = () => {
    setMenuOpen(false);
    void openFromFile();
  };

  const statusLabel: Record<string, string> = {
    "offline-guest": "Local only — sign in to sync",
    syncing: "Syncing…",
    synced: "Synced to your cloud",
    offline: "Offline — changes saved locally",
    conflict: "Sync conflict",
    locked: "Locked — enter your password to decrypt",
    error: "Sync error",
  };

  const bgs = CANVAS_BACKGROUNDS;

  return (
    <div className="top-left">
      <div className="island" style={{ display: "flex", alignItems: "center", padding: 3 }} ref={menuRef}>
        <button
          className="menu-btn"
          title="Menu"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Menu size={18} />
        </button>
        <span className="wordmark" style={{ paddingRight: 12, paddingLeft: 4 }}>
          Lakar
        </span>
        {menuOpen && (
          <div className="menu-pop" style={{ top: "calc(100% + 8px)", left: 0 }}>
            <button className="menu-item" onClick={openFile}>
              <FolderOpen size={16} /> Open…
              <span className="shortcut">Ctrl+O</span>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                const s = useStore.getState();
                saveSceneFile(s.elements, s.canvasBg, s.sceneTitle);
                setMenuOpen(false);
              }}
            >
              <Download size={16} /> Save to file
              <span className="shortcut">Ctrl+S</span>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setDialog("export");
                setMenuOpen(false);
              }}
            >
              <Image size={16} /> Export image…
              <span className="shortcut">Ctrl+E</span>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                const s = useStore.getState();
                exportExcalidrawFile(s.elements, s.canvasBg, s.sceneTitle);
                setMenuOpen(false);
              }}
            >
              <FileUp size={16} /> Export for Excalidraw
            </button>
            <div className="menu-sep" />
            <div className="menu-heading">Canvas background</div>
            <div className="menu-swatch-row">
              {bgs.map((c) => (
                <button
                  key={c}
                  className={`swatch ${canvasBg === c ? "selected" : ""}`}
                  style={{ background: themedColor(c, theme) }}
                  title={c}
                  aria-label={`Canvas background ${c}`}
                  onClick={() => setCanvasBg(c)}
                />
              ))}
            </div>
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Light theme" : "Dark theme"}
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setDialog("help");
                setMenuOpen(false);
              }}
            >
              <HelpCircle size={16} /> Keyboard shortcuts
              <span className="shortcut">?</span>
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item danger"
              onClick={() => {
                setDialog("clear-confirm");
                setMenuOpen(false);
              }}
            >
              <Trash2 size={16} /> Clear canvas…
            </button>
          </div>
        )}
      </div>
      <div className="island scene-chip">
        <span
          className={`sync-dot ${syncStatus}`}
          title={statusLabel[syncStatus]}
        />
        <input
          className="scene-title-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitleDraft(sceneTitle);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Scene title"
          title={statusLabel[syncStatus]}
        />
      </div>
    </div>
  );
};
