import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CloudOff,
  FilePlus2,
  Folder,
  FolderPlus,
  MoreHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import { useStore } from "../store";
import type { RoomResume, SceneMeta } from "../types";
import { syncManager } from "../sync/manager";
import { collab, CollabError } from "../collab/manager";
import { ApiError } from "../sync/api";

const guardLive = (targetSceneId: string | "new" | null): boolean => {
  if (!collab.isLive()) return false;
  syncManager.queueSceneAfterRoom(targetSceneId);
  useStore.getState().setDialog("leave-live-confirm");
  return true;
};

const timeAgo = (ts: number) => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

export const ScenesDrawer = () => {
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.setDialog);
  const scenes = useStore((s) => s.scenes);
  const folders = useStore((s) => s.folders);
  const sceneId = useStore((s) => s.sceneId);
  const user = useStore((s) => s.user);
  const sharedRooms = useStore((s) => s.sharedRooms);
  const liveRoomId = useStore((s) => s.collab.roomId);
  const liveStatus = useStore((s) => s.collab.status);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sharedCollapsed, setSharedCollapsed] = useState(false);
  const [mineCollapsed, setMineCollapsed] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);

  if (dialog !== "scenes") return null;

  const close = () => setDialog(null);
  const live = liveStatus !== "idle" && liveStatus !== "ended";
  const q = search.trim().toLowerCase();
  const currentRoomId = syncManager.currentRoomSceneId();
  const shared = sharedRooms.filter(
    (r) => !q || r.title.toLowerCase().includes(q),
  );
  const filtered = q
    ? scenes.filter((sc) => sc.title.toLowerCase().includes(q))
    : scenes;

  const unfiled = filtered.filter((sc) => !sc.folderId);
  const byFolder = new Map<string, SceneMeta[]>();
  for (const f of folders) byFolder.set(f.id, []);
  for (const sc of filtered) {
    if (sc.folderId && byFolder.has(sc.folderId)) {
      byFolder.get(sc.folderId)!.push(sc);
    }
  }

  const toggleFolder = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const newScene = async () => {
    if (guardLive("new")) return;
    const id = await syncManager.createScene("Untitled scene", null, true);
    if (id) close();
  };

  const newFolder = async () => {
    const id = await syncManager.createFolder("New folder");
    if (id) setRenamingFolder(id);
  };

  return (
    <>
      <div className="drawer-backdrop" onPointerDown={close} />
      <aside className="drawer" aria-label="Your scenes">
        <div className="drawer-header">
          <h2>{user ? "Your scenes" : "Shared canvases"}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close scenes">
            <X size={17} />
          </button>
        </div>
        <input
          className="drawer-search"
          placeholder={user ? "Search scenes…" : "Search shared canvases…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="drawer-list">
          {shared.length > 0 && (
            <div className="drawer-section">
              <button
                className="drawer-section-head"
                aria-expanded={!sharedCollapsed || !!q}
                onClick={() => setSharedCollapsed(!sharedCollapsed)}
              >
                {sharedCollapsed && !q ? (
                  <ChevronRight size={13} />
                ) : (
                  <ChevronDown size={13} />
                )}
                Shared canvases
                <span className="count">{shared.length}</span>
              </button>
              {(!sharedCollapsed || q) &&
                shared.map((room) => (
                  <SharedRow
                    key={room.roomId}
                    room={room}
                    live={live && liveRoomId === room.roomId}
                    current={currentRoomId === room.roomId}
                    onOpen={close}
                  />
                ))}
            </div>
          )}
          {user && scenes.length === 0 && (
            <div className="drawer-empty">
              <span className="hand">Nothing here yet</span>
              Create a scene and it syncs to your server, encrypted before it
              leaves this device.
            </div>
          )}
          {user && shared.length > 0 && scenes.length > 0 && (
            <button
              className="drawer-section-head"
              aria-expanded={!mineCollapsed || !!q}
              onClick={() => setMineCollapsed(!mineCollapsed)}
            >
              {mineCollapsed && !q ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
              Your scenes
              <span className="count">{filtered.length}</span>
            </button>
          )}
          {(!mineCollapsed || q || shared.length === 0) && (
            <>
              {unfiled.map((sc) => (
                <SceneRow key={sc.id} scene={sc} current={sc.id === sceneId} onOpen={close} />
              ))}
              {folders.map((f) => {
                const inside = byFolder.get(f.id) ?? [];
                if (q && inside.length === 0) return null;
                const isCollapsed = collapsed.has(f.id) && !q;
                return (
                  <div className="drawer-folder" key={f.id}>
                    <FolderHead
                      id={f.id}
                      name={f.name}
                      count={inside.length}
                      collapsed={isCollapsed}
                      renaming={renamingFolder === f.id}
                      onToggle={() => toggleFolder(f.id)}
                      onRenameStart={() => setRenamingFolder(f.id)}
                      onRenameEnd={() => setRenamingFolder(null)}
                    />
                    {!isCollapsed &&
                      inside.map((sc) => (
                        <div key={sc.id} style={{ paddingLeft: 14 }}>
                          <SceneRow scene={sc} current={sc.id === sceneId} onOpen={close} />
                        </div>
                      ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
        {user ? (
          <div className="drawer-footer">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={newScene}>
              <FilePlus2 size={15} /> New scene
            </button>
            <button className="btn btn-outline" onClick={newFolder}>
              <FolderPlus size={15} /> Folder
            </button>
          </div>
        ) : (
          <div className="drawer-footer drawer-footer-anon">
            <div className="anon-note">
              <CloudOff size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                You're not signed in — these canvases live only in this
                browser.
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {live && (
                <button
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={() => setDialog("share")}
                >
                  <UsersRound size={15} /> Live session
                </button>
              )}
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => setDialog("auth")}
              >
                Sign in
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

const SharedRow = ({
  room,
  live,
  current,
  onOpen,
}: {
  room: RoomResume;
  live: boolean;
  current: boolean;
  onOpen: () => void;
}) => {
  const setDialog = useStore((s) => s.setDialog);
  const setPendingRoomId = useStore((s) => s.setPendingRoomId);
  const toast = useStore((s) => s.toast);
  const sceneTitle = useStore((s) => s.sceneTitle);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmingEnd(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const enter = () => {
    if (busy) return;
    if (live && current) {
      onOpen();
      return;
    }
    if (room.mode === "password") {
      setPendingRoomId(room.roomId);
      setDialog("join");
      return;
    }
    setBusy(true);
    void collab
      .rejoin(room)
      .then(onOpen)
      .catch((err) =>
        toast(
          err instanceof CollabError || err instanceof ApiError
            ? err.message
            : "Could not rejoin that session",
          "error",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <div
        className={`scene-row ${current ? "current" : ""}`}
        role="button"
        tabIndex={0}
        onClick={enter}
        onKeyDown={(e) => {
          if (e.key === "Enter") enter();
        }}
      >
        <span className={`shared-dot ${live ? "live" : ""}`} />
        <div className="scene-row-body">
          <div className="scene-row-title">
            {current ? sceneTitle : room.title}
          </div>
          <div className="scene-row-meta">
            {busy
              ? "rejoining…"
              : live
                ? "live now"
                : current
                  ? "not connected — click to rejoin"
                  : `left ${timeAgo(room.leftAt)}`}
          </div>
        </div>
        <button
          className="icon-btn kebab"
          data-open={menuOpen}
          aria-label={`Options for ${room.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {menuOpen && (
        <div className="menu-pop" style={{ right: 4, top: "100%" }}>
          {current && (
            <button
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                setDialog("keep-collab-copy");
              }}
            >
              Save a separate copy…
            </button>
          )}
          {live && (
            <button
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                setDialog("share");
              }}
            >
              Session details…
            </button>
          )}
          {(current || live) && <div className="menu-sep" />}
          {!live && room.ownerToken && (
            <button
              className="menu-item danger"
              disabled={busy}
              onClick={async () => {
                if (!confirmingEnd) {
                  setConfirmingEnd(true);
                  return;
                }
                setBusy(true);
                const ok = await collab.endSavedSession(room);
                setBusy(false);
                setConfirmingEnd(false);
                if (ok) setMenuOpen(false);
              }}
            >
              {confirmingEnd
                ? "Really end it for everyone?"
                : "End session for everyone"}
            </button>
          )}
          <button
            className="menu-item danger"
            disabled={live}
            title={live ? "Leave the session before removing it" : undefined}
            onClick={() => {
              setMenuOpen(false);
              void collab.forgetSavedSession(room.roomId).then(() => {
                toast("Removed that shared canvas from this device", "info");
              });
            }}
          >
            Remove from this device
          </button>
        </div>
      )}
    </div>
  );
};

const FolderHead = ({
  id,
  name,
  count,
  collapsed,
  renaming,
  onToggle,
  onRenameStart,
  onRenameEnd,
}: {
  id: string;
  name: string;
  count: number;
  collapsed: boolean;
  renaming: boolean;
  onToggle: () => void;
  onRenameStart: () => void;
  onRenameEnd: () => void;
}) => {
  const [draft, setDraft] = useState(name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(name), [name]);

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

  if (renaming) {
    return (
      <input
        className="drawer-search"
        style={{ margin: "4px 0", width: "100%" }}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(name);
            onRenameEnd();
          }
        }}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed && trimmed !== name) {
            void syncManager.renameFolder(id, trimmed);
          }
          onRenameEnd();
        }}
      />
    );
  }

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <button className="drawer-folder-head" onClick={onToggle}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Folder size={14} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        <span className="count">{count}</span>
        <span
          className="icon-btn kebab"
          style={{ opacity: 1, width: 24, height: 24 }}
          role="button"
          tabIndex={0}
          aria-label={`Folder options for ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
        >
          <MoreHorizontal size={14} />
        </span>
      </button>
      {menuOpen && (
        <div className="menu-pop" style={{ right: 0, top: "100%" }}>
          <button
            className="menu-item"
            onClick={() => {
              setMenuOpen(false);
              onRenameStart();
            }}
          >
            Rename folder
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              setMenuOpen(false);
              void syncManager.deleteFolder(id);
            }}
          >
            Delete folder (keeps scenes)
          </button>
        </div>
      )}
    </div>
  );
};

const SceneRow = ({
  scene,
  current,
  onOpen,
}: {
  scene: SceneMeta;
  current: boolean;
  onOpen: () => void;
}) => {
  const folders = useStore((s) => s.folders);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(scene.title);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(scene.title), [scene.title]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setMoveOpen(false);
        setConfirmingDelete(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  if (renaming) {
    return (
      <input
        className="drawer-search"
        style={{ margin: "4px 0", width: "100%" }}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(scene.title);
            setRenaming(false);
          }
        }}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed && trimmed !== scene.title) {
            void syncManager.renameScene(scene.id, trimmed);
          }
          setRenaming(false);
        }}
      />
    );
  }

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <div
        className={`scene-row ${current ? "current" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (guardLive(scene.id)) return;
          void syncManager.openScene(scene.id);
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (guardLive(scene.id)) return;
            void syncManager.openScene(scene.id);
            onOpen();
          }
        }}
      >
        <div className="scene-row-body">
          <div className="scene-row-title">{scene.title}</div>
          <div className="scene-row-meta">
            {scene.dirty ? "saving…" : timeAgo(scene.updatedAt)}
          </div>
        </div>
        <button
          className="icon-btn kebab"
          data-open={menuOpen}
          aria-label={`Options for ${scene.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
            setMoveOpen(false);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {menuOpen && (
        <div className="menu-pop" style={{ right: 4, top: "100%" }}>
          {moveOpen ? (
            <>
              <div className="menu-heading">Move to</div>
              <button
                className="menu-item"
                disabled={!scene.folderId}
                onClick={() => {
                  setMenuOpen(false);
                  void syncManager.moveSceneToFolder(scene.id, null);
                }}
              >
                No folder
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  className="menu-item"
                  disabled={scene.folderId === f.id}
                  onClick={() => {
                    setMenuOpen(false);
                    void syncManager.moveSceneToFolder(scene.id, f.id);
                  }}
                >
                  <Folder size={14} /> {f.name}
                </button>
              ))}
            </>
          ) : (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  void syncManager.duplicateScene(scene.id);
                }}
              >
                Duplicate
              </button>
              <button className="menu-item" onClick={() => setMoveOpen(true)}>
                Move to folder…
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item danger"
                onClick={() => {
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  setMenuOpen(false);
                  setConfirmingDelete(false);
                  void syncManager.deleteScene(scene.id);
                }}
              >
                {confirmingDelete ? "Really delete? This can't be undone" : "Delete"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
