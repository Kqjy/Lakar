import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudOff,
  FolderClosed,
  KeyRound,
  LogOut,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useStore } from "../store";
import { syncManager } from "../sync/manager";

const initials = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
};

export const TopRight = () => {
  const user = useStore((s) => s.user);
  const lockedAccount = useStore((s) => s.lockedAccount);
  const setDialog = useStore((s) => s.setDialog);
  const syncStatus = useStore((s) => s.syncStatus);
  const collabState = useStore((s) => s.collab);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const live = collabState.status !== "idle" && collabState.status !== "ended";

  return (
    <div className="top-right">
      {live ? (
        <button
          className={`island live-chip ${collabState.status}`}
          onClick={() => setDialog("share")}
          title="Live session details"
        >
          <span className="live-dot" />
          <span className="live-label">
            {collabState.status === "reconnecting" ? "Reconnecting" : "Live"}
          </span>
          <span className="peer-stack">
            {collabState.peers.slice(0, 4).map((p) => (
              <span
                key={p.id}
                className="peer-avatar"
                style={{ background: p.color }}
                title={p.isSelf ? `${p.name} (you)` : p.name}
              >
                {initials(p.name)}
              </span>
            ))}
            {collabState.peers.length > 4 && (
              <span className="peer-avatar more">
                +{collabState.peers.length - 4}
              </span>
            )}
          </span>
        </button>
      ) : (
        <button
          className="island share-btn"
          onClick={() => setDialog("share")}
          title="Share this canvas for live collaboration"
        >
          <UsersRound size={16} />
          Share
        </button>
      )}
      {user && (
        <button
          className="island icon-btn"
          style={{ width: 40, height: 40 }}
          title="Your scenes"
          aria-label="Your scenes"
          onClick={() => setDialog("scenes")}
        >
          <FolderClosed size={18} />
        </button>
      )}
      {user ? (
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            className="island user-chip"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            title={user.email}
          >
            <span className="avatar">{user.email[0]}</span>
            {syncStatus === "offline" || syncStatus === "error" ? (
              <CloudOff size={15} style={{ color: "var(--text-faint)" }} />
            ) : (
              <Cloud size={15} style={{ color: "var(--accent)" }} />
            )}
          </button>
          {menuOpen && (
            <div className="menu-pop" style={{ top: "calc(100% + 8px)", right: 0 }}>
              <div className="menu-heading" style={{ textTransform: "none", fontSize: 12.5, letterSpacing: 0 }}>
                {user.email}
              </div>
              <div
                className="menu-heading"
                style={{ paddingTop: 0, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}
              >
                Everything you draw is encrypted on your device before it
                reaches the server.
              </div>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setDialog("account");
                  setMenuOpen(false);
                }}
              >
                <UserRound size={16} /> Account
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  void syncManager.signOut();
                }}
              >
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      ) : lockedAccount ? (
        <button
          className="btn btn-primary"
          style={{ height: 40, boxShadow: "var(--shadow-island)" }}
          title={`Signed in as ${lockedAccount.email} — your key isn't on this device`}
          onClick={() => setDialog("unlock")}
        >
          <KeyRound size={16} />
          Unlock scenes
        </button>
      ) : (
        <button className="btn btn-primary" style={{ height: 40, boxShadow: "var(--shadow-island)" }} onClick={() => setDialog("auth")}>
          <Cloud size={16} />
          Sign in to sync
        </button>
      )}
    </div>
  );
};
