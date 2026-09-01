import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Check,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  Link2,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  Users,
  X,
} from "lucide-react";
import { getSelectedElements, useStore } from "../store";
import { copyPNGToClipboard, exportPNG, exportSVG, getExportSize, renderToCanvas } from "../export/image";
import { preloadImages } from "../renderer/imageCache";
import { syncManager } from "../sync/manager";
import { history } from "../history";
import {
  api,
  ApiError,
  fetchMeta,
  type ServerMeta,
  type WrapRecord,
} from "../sync/api";
import { collab, CollabError } from "../collab/manager";
import { presence } from "../collab/presence";
import { centerOnPoint } from "../interaction/view";
import { parseRoomHash } from "../crypto/room";
import { AccountKeyError } from "../crypto/account";
import { isValidRecoveryCode } from "../crypto/recovery";
import {
  hasPlatformAuthenticator,
  isPasskeySupported,
  PasskeyError,
} from "../crypto/passkey";
import type { RoomMode } from "../types";
import type { RoomResume } from "../sync/local";
import { PublishDialog } from "./PublishDialog";
import { MermaidDialog } from "./MermaidDialog";

export const Dialogs = () => {
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.setDialog);

  if (!dialog || dialog === "scenes") return null;

  const close = () => setDialog(null);
  const locked =
    dialog === "keep-collab-copy" ||
    dialog === "leave-live-confirm" ||
    dialog === "recovery-code";

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (!locked && e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`dialog ${dialog === "help" ? "dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        {!locked && (
          <div style={{ position: "relative" }}>
            <button
              className="icon-btn"
              style={{ position: "absolute", top: -10, right: -10 }}
              onClick={close}
              aria-label="Close dialog"
            >
              <X size={17} />
            </button>
          </div>
        )}
        {dialog === "export" && <ExportDialog />}
        {dialog === "help" && <HelpDialog />}
        {dialog === "auth" && <AuthDialog />}
        {dialog === "clear-confirm" && <ClearConfirm />}
        {dialog === "account" && <AccountDialog />}
        {dialog === "share" && <ShareDialog />}
        {dialog === "publish" && <PublishDialog />}
        {dialog === "mermaid" && <MermaidDialog />}
        {dialog === "join" && <JoinDialog />}
        {dialog === "keep-collab-copy" && <KeepCopyDialog />}
        {dialog === "leave-live-confirm" && <LeaveLiveDialog />}
        {dialog === "unlock" && <UnlockDialog />}
        {dialog === "recovery-code" && <RecoveryCodeDialog />}
        {dialog === "recover" && <RecoverDialog />}
        {dialog === "change-password" && <ChangePasswordDialog />}
      </div>
    </div>
  );
};

const ExportDialog = () => {
  const theme = useStore((s) => s.theme);
  const canvasBg = useStore((s) => s.canvasBg);
  const sceneTitle = useStore((s) => s.sceneTitle);
  const toast = useStore((s) => s.toast);
  const setDialog = useStore((s) => s.setDialog);
  const [withBackground, setWithBackground] = useState(true);
  const [scale, setScale] = useState(2);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const selectedCount = getSelectedElements().length;

  const elements = useMemo(() => {
    const s = useStore.getState();
    const all = s.elements.filter((el) => !el.isDeleted);
    if (selectionOnly && selectedCount) {
      const sel = s.selectedIds;
      return all.filter((el) => sel.has(el.id));
    }
    return all;
  }, [selectionOnly, selectedCount]);

  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    if (!elements.length) {
      host.innerHTML = "";
      host.textContent = "Nothing to export yet";
      return;
    }
    let cancelled = false;
    void preloadImages(
      elements
        .filter((el) => el.type === "image")
        .map((el) => (el as { dataURL: string }).dataURL),
    ).then(() => {
      if (cancelled) return;
      const canvas = renderToCanvas({
        elements,
        theme,
        background: withBackground ? canvasBg : null,
        scale: 1,
      });
      host.innerHTML = "";
      host.appendChild(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [elements, theme, canvasBg, withBackground]);

  const opts = {
    elements,
    theme,
    background: withBackground ? canvasBg : null,
  };

  return (
    <>
      <h2 className="dialog-title">Export image</h2>
      <p className="dialog-sub">
        PNG for pasting anywhere, SVG for crisp embeds that scale.
      </p>
      <div className="export-preview" ref={previewRef} />
      <div className="toggle-row">
        <span>Background</span>
        <button
          className="switch"
          data-on={withBackground}
          onClick={() => setWithBackground(!withBackground)}
          aria-label="Toggle background"
          role="switch"
          aria-checked={withBackground}
        />
      </div>
      {selectedCount > 0 && (
        <div className="toggle-row">
          <span>Selection only ({selectedCount} elements)</span>
          <button
            className="switch"
            data-on={selectionOnly}
            onClick={() => setSelectionOnly(!selectionOnly)}
            aria-label="Toggle selection only"
            role="switch"
            aria-checked={selectionOnly}
          />
        </div>
      )}
      <div className="toggle-row">
        <span>
          Scale
          {elements.length > 0 && (
            <span className="export-dim">
              {getExportSize(elements, scale).width} × {getExportSize(elements, scale).height} px
            </span>
          )}
        </span>
        <div className="seg-row" style={{ width: 150 }}>
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              className={`seg-btn ${scale === s ? "active" : ""}`}
              onClick={() => setScale(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="dialog-actions">
        <button
          className="btn btn-outline"
          disabled={!elements.length}
          onClick={async () => {
            try {
              await copyPNGToClipboard({ ...opts, scale });
              toast("Image copied to clipboard", "success");
            } catch {
              toast("Could not copy — try downloading instead", "error");
            }
          }}
        >
          Copy PNG
        </button>
        <button
          className="btn btn-outline"
          disabled={!elements.length}
          onClick={() => {
            exportSVG(opts, `${sceneTitle || "lakar"}.svg`);
            setDialog(null);
          }}
        >
          Download SVG
        </button>
        <button
          className="btn btn-primary"
          disabled={!elements.length}
          onClick={() => {
            void exportPNG({ ...opts, scale }, `${sceneTitle || "lakar"}.png`);
            setDialog(null);
          }}
        >
          Download PNG
        </button>
      </div>
    </>
  );
};

const SHORTCUTS: [string, string][] = [
  ["Select", "V or 1"],
  ["Hand (pan)", "H"],
  ["Rectangle", "R or 2"],
  ["Diamond", "D or 3"],
  ["Ellipse", "O or 4"],
  ["Arrow", "A or 5"],
  ["Line", "L or 6"],
  ["Draw", "P or 7"],
  ["Text", "T or 8"],
  ["Frame", "F"],
  ["Laser pointer", "K"],
  ["Eraser", "E or 0"],
  ["Insert image", "9"],
  ["Open the Satchel", "S"],
  ["Keep tool active", "Q"],
];

const SHORTCUTS_EDIT: [string, string][] = [
  ["Undo / Redo", "Ctrl+Z / Ctrl+Shift+Z"],
  ["Copy / Cut / Paste", "Ctrl+C / X / V"],
  ["Duplicate", "Ctrl+D or Alt+drag"],
  ["Delete", "Del"],
  ["Select all", "Ctrl+A"],
  ["Group / Ungroup", "Ctrl+G / Ctrl+Shift+G"],
  ["Nudge", "Arrow keys"],
  ["Edit text", "Enter or double-click"],
  ["Text inside a shape", "Double-click the shape"],
  ["Bring forward / back", "Ctrl+] / Ctrl+["],
  ["Constrain / keep ratio", "Hold Shift"],
  ["Draw from center", "Hold Alt"],
  ["Add selection to Satchel", "Right-click"],
];

const SHORTCUTS_VIEW: [string, string][] = [
  ["Pan", "Space+drag or middle mouse"],
  ["Zoom", "Ctrl+wheel"],
  ["Zoom in / out", "Ctrl++ / Ctrl+-"],
  ["Reset zoom", "Ctrl+0"],
  ["Zoom to fit", "Shift+1"],
  ["Zoom to selection", "Shift+2"],
  ["Save to file", "Ctrl+S"],
  ["Export image", "Ctrl+E"],
];

const HelpDialog = () => (
  <>
    <h2 className="dialog-title">Keyboard shortcuts</h2>
    <div className="shortcuts-grid">
      <div className="shortcuts-section">Tools</div>
      {SHORTCUTS.map(([label, keys]) => (
        <div className="shortcut-row" key={label}>
          <span>{label}</span>
          <kbd>{keys}</kbd>
        </div>
      ))}
      <div className="shortcuts-section">Editing</div>
      {SHORTCUTS_EDIT.map(([label, keys]) => (
        <div className="shortcut-row" key={label}>
          <span>{label}</span>
          <kbd>{keys}</kbd>
        </div>
      ))}
      <div className="shortcuts-section">View & files</div>
      {SHORTCUTS_VIEW.map(([label, keys]) => (
        <div className="shortcut-row" key={label}>
          <span>{label}</span>
          <kbd>{keys}</kbd>
        </div>
      ))}
    </div>
  </>
);

const AuthDialog = () => {
  const pendingInvite = useStore((s) => s.pendingInviteCode);
  const [mode, setMode] = useState<"signin" | "signup">(
    pendingInvite ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState(pendingInvite ?? "");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const [invitesForced, setInvitesForced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const setPendingRecoveryCode = useStore((s) => s.setPendingRecoveryCode);
  const setPendingInviteCode = useStore((s) => s.setPendingInviteCode);

  useEffect(() => {
    let cancelled = false;
    void fetchMeta()
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  const needsInvite = invitesForced || !!meta?.invitesRequired;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInviteError(null);
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address");
      return;
    }
    if (mode === "signup") {
      if (password.length < 10) {
        setError("Use at least 10 characters — this password protects your encryption key");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match");
        return;
      }
      if (needsInvite && !inviteCode.trim()) {
        setInviteError("This server is invite-only — enter an invite code");
        return;
      }
    }
    setBusy(true);
    try {
      const code =
        mode === "signup"
          ? await syncManager.signUp(
              trimmed,
              password,
              inviteCode.trim() || undefined,
            )
          : await syncManager.signIn(trimmed, password);
      setPendingInviteCode(null);
      toast(
        mode === "signup"
          ? "Account created — your scenes now sync encrypted"
          : "Signed in — your scenes are syncing",
        "success",
      );
      if (code) {
        setPendingRecoveryCode(code);
        setDialog("recovery-code");
      } else {
        setDialog(null);
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "invite-required" || err.code === "invite-invalid")
      ) {
        setInvitesForced(true);
        setInviteError(err.message);
      } else if (err instanceof ApiError) {
        setError(
          err.status === 0
            ? "Can't reach the server — check your connection"
            : err.message,
        );
      } else {
        setError("Something went wrong — try again");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="dialog-title">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h2>
      <p className="dialog-sub">
        {mode === "signin"
          ? "Sign in to open your encrypted scenes on this device."
          : needsInvite
            ? "This server is invite-only. Your scenes sync to it, readable only by you."
            : "Sync every scene to your own server, readable only by you."}
      </p>
      <div className="e2ee-note">
        <ShieldCheck size={26} style={{ flexShrink: 0 }} />
        <span>
          End-to-end encrypted: your password never leaves this device, and the
          server only ever stores ciphertext.{" "}
          {mode === "signup"
            ? "You'll get a recovery code next — it is the only way back in if you forget your password."
            : "Only your password or your recovery code can open your scenes."}
        </span>
      </div>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        {mode === "signup" && (
          <div className="field">
            <label htmlFor="auth-confirm">Confirm password</label>
            <input
              id="auth-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        )}
        {mode === "signup" && needsInvite && (
          <div className="field">
            <label htmlFor="auth-invite">Invite code</label>
            <input
              id="auth-invite"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}
              placeholder="LKR-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {inviteError && (
              <div className="form-error" style={{ marginBottom: 0 }}>
                {inviteError}
              </div>
            )}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <button
          className="btn btn-primary"
          style={{ width: "100%", height: 42 }}
          disabled={busy}
          type="submit"
        >
          {busy
            ? "Deriving encryption keys…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
      {mode === "signin" && (
        <>
          <PasskeyButton onDone={() => setDialog(null)} />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button className="link-btn" onClick={() => setDialog("recover")}>
              Forgot your password?
            </button>
          </div>
        </>
      )}
      <div className="auth-switch">
        {mode === "signin" ? "New here?" : "Already have an account?"}
        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInviteError(null);
          }}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </div>
    </>
  );
};

const RecoveryCodeDialog = () => {
  const code = useStore((s) => s.pendingRecoveryCode);
  const setPendingRecoveryCode = useStore((s) => s.setPendingRecoveryCode);
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const [saved, setSaved] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const { copied, copy } = useCopy();

  if (!code) return null;

  const done = () => {
    setPendingRecoveryCode(null);
    setDialog(null);
  };

  const download = () => {
    const blob = new Blob(
      [
        `Lakar recovery code\n\n${code}\n\n` +
          `This code can open your encrypted scenes and reset your password.\n` +
          `Anyone who has it has full access to your account. Store it somewhere safe.\n` +
          `Lakar cannot recover it for you — generate a new one from Account → Security.\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lakar-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast("Recovery code downloaded", "success");
  };

  return (
    <>
      <h2 className="dialog-title">Save your recovery code</h2>
      <p className="dialog-sub">
        This is shown once and never again. Without it, a forgotten password
        means your scenes are gone for good.
      </p>
      <div className="recovery-code">{code}</div>
      <div className="recovery-actions">
        <button className="btn btn-outline" onClick={() => copy(code)}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn btn-outline" onClick={download}>
          <Download size={15} />
          Download
        </button>
      </div>
      <div className="warn-note">
        <ShieldAlert size={26} style={{ flexShrink: 0 }} />
        <span>
          Treat this like your password. Anyone who has it can read every scene
          in your account and reset your password.
        </span>
      </div>
      <label className="confirm-check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <span>I've saved my recovery code somewhere safe</span>
      </label>
      <button
        className="btn btn-primary"
        style={{ width: "100%", height: 42 }}
        disabled={!saved}
        onClick={done}
      >
        Continue
      </button>
      <div style={{ textAlign: "center", marginTop: 12 }}>
        {confirmSkip ? (
          <span style={{ fontSize: 13, color: "var(--danger)" }}>
            Skip without saving it?{" "}
            <button className="link-btn" onClick={done}>
              Yes, skip
            </button>{" "}
            ·{" "}
            <button className="link-btn" onClick={() => setConfirmSkip(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="link-btn" onClick={() => setConfirmSkip(true)}>
            Skip for now
          </button>
        )}
      </div>
    </>
  );
};

const UnlockDialog = () => {
  const locked = useStore((s) => s.lockedAccount);
  const setDialog = useStore((s) => s.setDialog);
  const setPendingRecoveryCode = useStore((s) => s.setPendingRecoveryCode);
  const toast = useStore((s) => s.toast);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!locked) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const code = await syncManager.unlock(locked.email, password);
      toast("Unlocked — your scenes are syncing", "success");
      if (code) {
        setPendingRecoveryCode(code);
        setDialog("recovery-code");
      } else {
        setDialog(null);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? "Can't reach the server — check your connection"
          : err instanceof ApiError || err instanceof AccountKeyError
            ? err.message
            : "That password is incorrect",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="dialog-title">Unlock your scenes</h2>
      <p className="dialog-sub">
        Signed in as <strong>{locked.email}</strong>. Your encryption key isn't
        on this device, so your password is needed to rebuild it.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="unlock-password">Password</label>
          <input
            id="unlock-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button
          className="btn btn-primary"
          style={{ width: "100%", height: 42 }}
          disabled={busy || !password}
          type="submit"
        >
          {busy ? "Deriving encryption keys…" : "Unlock"}
        </button>
      </form>
      <PasskeyButton onDone={() => setDialog(null)} />
      <div className="dialog-foot-links">
        <button className="link-btn" onClick={() => setDialog("recover")}>
          Use a recovery code
        </button>
        <button
          className="link-btn"
          style={{ color: "var(--text-dim)" }}
          onClick={() => {
            setDialog(null);
            void syncManager.signOut();
          }}
        >
          Sign out instead
        </button>
      </div>
    </>
  );
};

const RecoverDialog = () => {
  const setDialog = useStore((s) => s.setDialog);
  const lockedEmail = useStore((s) => s.lockedAccount?.email);
  const toast = useStore((s) => s.toast);
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidRecoveryCode(code)) {
      setError("That doesn't look like a recovery code — check for typos");
      return;
    }
    if (password.length < 10) {
      setError("Use at least 10 characters — this password protects your key");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await syncManager.recoverAccount(email.trim().toLowerCase(), code, password);
      setDialog(null);
      toast("Account recovered — your scenes are syncing", "success");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? "Can't reach the server — check your connection"
          : err instanceof ApiError || err instanceof AccountKeyError
            ? err.message
            : "Could not recover with that code",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="dialog-title">Recover your account</h2>
      <p className="dialog-sub">
        Your recovery code can open your encryption key and set a new password.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="rec-email">Email</label>
          <input
            id="rec-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus={!lockedEmail}
          />
        </div>
        <div className="field">
          <label htmlFor="rec-code">Recovery code</label>
          <input
            id="rec-code"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus={!!lockedEmail}
          />
        </div>
        <div className="field">
          <label htmlFor="rec-pw">New password</label>
          <input
            id="rec-pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="field">
          <label htmlFor="rec-pw2">Confirm new password</label>
          <input
            id="rec-pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button
          className="btn btn-primary"
          style={{ width: "100%", height: 42 }}
          disabled={busy}
          type="submit"
        >
          {busy ? "Recovering…" : "Recover account"}
        </button>
      </form>
      <div className="auth-switch">
        Remembered it?
        <button onClick={() => setDialog(lockedEmail ? "unlock" : "auth")}>
          Go back
        </button>
      </div>
    </>
  );
};

const PasskeySection = () => {
  const toast = useStore((s) => s.toast);
  const [passkeys, setPasskeys] = useState<WrapRecord[] | null>(null);
  const [supported, setSupported] = useState(isPasskeySupported());
  const [mode, setMode] = useState<null | "add" | string>(null);
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getKeys()
      .then((s) => setPasskeys(s.wraps.filter((w) => w.kind === "passkey")))
      .catch(() => setPasskeys([]));
    void hasPlatformAuthenticator().then((ok) => setSupported(isPasskeySupported() && ok));
  }, []);

  const reset = () => {
    setMode(null);
    setPassword("");
    setLabel("");
    setError(null);
  };

  const refresh = (state: { wraps: WrapRecord[] }) =>
    setPasskeys(state.wraps.filter((w) => w.kind === "passkey"));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "add") {
        await syncManager.addPasskey(password, label.trim() || "Passkey");
        toast("Passkey added — you can now unlock without your password", "success");
      } else if (mode) {
        await syncManager.removePasskey(password, mode);
        toast("Passkey removed", "info");
      }
      refresh(await api.getKeys());
      reset();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That password is incorrect"
          : err instanceof PasskeyError ||
              err instanceof ApiError ||
              err instanceof AccountKeyError
            ? err.message
            : "Could not update your passkeys",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sec-group">
      <div className="sec-label">Passkeys</div>
      <div className="sec-row">
        <div className="sec-row-text">
          <div className="sec-row-title">Unlock with a passkey</div>
          <div className="sec-row-desc">
            {supported
              ? "Your fingerprint or device PIN unlocks your scenes. The key comes from the authenticator — the server never sees it."
              : "This browser or device has no authenticator that can hold an encryption key."}
          </div>
        </div>
        <button
          className="btn btn-outline"
          disabled={!supported || mode !== null}
          onClick={() => setMode("add")}
        >
          Add…
        </button>
      </div>

      {passkeys?.map((pk) => (
        <div className="sec-row" key={pk.slot}>
          <div className="sec-row-text">
            <div className="sec-row-title">{pk.label || "Passkey"}</div>
            <div className="sec-row-desc">
              Added {new Date(pk.createdAt).toLocaleDateString()}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            disabled={mode !== null}
            onClick={() => setMode(pk.slot)}
          >
            Remove
          </button>
        </div>
      ))}

      {mode && (
        <form onSubmit={submit} style={{ paddingTop: 4 }}>
          {mode === "add" && (
            <div className="field">
              <label htmlFor="pk-label">Name this passkey</label>
              <input
                id="pk-label"
                value={label}
                placeholder="MacBook Touch ID"
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="pk-password">
              {mode === "add"
                ? "Confirm your password to wrap your key for this passkey"
                : "Confirm your password to remove this passkey"}
            </label>
            <input
              id="pk-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              autoFocus={mode !== "add"}
            />
          </div>
          {mode === "add" && (
            <div className="dialog-note">
              You'll be asked to confirm with your device twice — once to create
              the passkey, once to read the key it holds.
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="dialog-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Cancel
            </button>
            <button
              className={`btn ${mode === "add" ? "btn-primary" : "btn-danger"}`}
              disabled={busy || !password}
              type="submit"
            >
              {busy
                ? mode === "add"
                  ? "Waiting for your device…"
                  : "Removing…"
                : mode === "add"
                  ? "Add passkey"
                  : "Remove passkey"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

const PasskeyButton = ({ onDone }: { onDone: () => void }) => {
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    void hasPlatformAuthenticator().then((ok) =>
      setSupported(isPasskeySupported() && ok),
    );
  }, []);

  if (!supported) return null;

  return (
    <button
      className="btn btn-outline"
      style={{ width: "100%", height: 42, marginTop: 10 }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await syncManager.signInWithPasskey();
          toast("Unlocked with your passkey", "success");
          onDone();
        } catch (err) {
          if (!(err instanceof PasskeyError) || err.code !== "cancelled") {
            toast(
              err instanceof PasskeyError || err instanceof ApiError
                ? err.message
                : "That passkey did not work",
              "error",
            );
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <Fingerprint size={16} />
      {busy ? "Waiting for your device…" : "Use a passkey"}
    </button>
  );
};

const ChangePasswordDialog = () => {
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) {
      setError("Use at least 10 characters — this password protects your key");
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match");
      return;
    }
    if (next === current) {
      setError("That's the same password you already have");
      return;
    }
    setBusy(true);
    try {
      await syncManager.changePassword(current, next);
      setDialog("account");
      toast("Password changed", "success");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That current password is incorrect"
          : err instanceof ApiError && err.status === 0
            ? "Can't reach the server — check your connection"
            : err instanceof ApiError || err instanceof AccountKeyError
              ? err.message
              : "Could not change your password",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="dialog-title">Change password</h2>
      <p className="dialog-sub">
        Your scenes stay exactly where they are — only the key that unlocks them
        is re-wrapped, so nothing has to be re-encrypted.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="cp-current">Current password</label>
          <input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="cp-next">New password</label>
          <input
            id="cp-next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="field">
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="dialog-note">
          Your other devices will need to sign in again. Your recovery code keeps
          working — it is tied to your account key, not to your password.
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDialog("account")}
          >
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Re-wrapping your key…" : "Change password"}
          </button>
        </div>
      </form>
    </>
  );
};

const ClearConfirm = () => {
  const setDialog = useStore((s) => s.setDialog);
  return (
    <>
      <h2 className="dialog-title">Clear this canvas?</h2>
      <p className="dialog-sub">
        Every element on “{useStore.getState().sceneTitle}” will be removed.
        You can still undo afterwards with Ctrl+Z.
      </p>
      <div className="dialog-actions">
        <button className="btn btn-outline" onClick={() => setDialog(null)}>
          Keep drawing
        </button>
        <button
          className="btn btn-danger"
          onClick={() => {
            const s = useStore.getState();
            for (const el of s.elements) el.isDeleted = true;
            s.clearSelection();
            s.bumpScene();
            history.commit();
            setDialog(null);
          }}
        >
          Clear canvas
        </button>
      </div>
    </>
  );
};

const useCopy = () => {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    return true;
  };
  return { copied, copy };
};

const ShareDialog = () => {
  const collabState = useStore((s) => s.collab);
  const pointers = useSyncExternalStore(presence.subscribe, presence.getPointers);
  const sceneTitle = useStore((s) => s.sceneTitle);
  const setPendingRoomId = useStore((s) => s.setPendingRoomId);
  const [nameDraft, setNameDraft] = useState(sceneTitle);
  const displayName = useStore((s) => s.displayName);
  const setDisplayName = useStore((s) => s.setDisplayName);
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<RoomMode>("link");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  const live = collabState.status !== "idle" && collabState.status !== "ended";

  useEffect(() => setNameDraft(sceneTitle), [sceneTitle]);

  const [saved, setSaved] = useState<RoomResume[]>([]);

  useEffect(() => {
    if (live) return;
    let alive = true;
    void collab
      .savedSessions()
      .then((all) => {
        if (alive) setSaved(all);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [live]);

  const resumeSession = async (r: RoomResume) => {
    setError(null);
    if (r.mode === "password") {
      setPendingRoomId(r.roomId);
      setDialog("join");
      return;
    }
    setBusy(true);
    try {
      await collab.rejoin(r);
      setDialog(null);
      toast("Back in the live session", "success");
    } catch (err) {
      setError(
        err instanceof CollabError || err instanceof ApiError
          ? err.message
          : "Could not rejoin that session",
      );
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const next = nameDraft.trim().slice(0, 120);
    if (!next) {
      setNameDraft(sceneTitle);
      return;
    }
    setNameDraft(next);
    if (next !== sceneTitle) useStore.getState().setSceneTitle(next);
  };

  if (live) {
    return (
      <>
        <h2 className="dialog-title">Live session</h2>
        <p className="dialog-sub">
          {collabState.mode === "password"
            ? "Anyone with the link and the password can draw here with you."
            : "Anyone with this link can draw here with you."}{" "}
          Leaving keeps the session running for the rest.
        </p>
        <div className="share-link-row">
          <input
            className="hex-input share-link"
            readOnly
            value={collabState.shareLink ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Session link"
          />
          <button
            className="btn btn-primary"
            onClick={async () => {
              const ok = await copy(collabState.shareLink ?? "");
              if (!ok) toast("Could not copy — select the link and copy it", "error");
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {collabState.mode === "password" && (
          <div className="e2ee-note">
            <KeyRound size={22} style={{ flexShrink: 0 }} />
            <span>
              Share the password separately from the link. The key is derived
              from it in each browser — the server never sees either.
            </span>
          </div>
        )}
        <div className="live-fields">
          <div className="field">
            <label htmlFor="live-display-name">Your name</label>
            <input
              id="live-display-name"
              value={displayName}
              maxLength={40}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="field">
            <label htmlFor="session-name">Session name</label>
            <input
              id="session-name"
              value={nameDraft}
              maxLength={120}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setNameDraft(sceneTitle);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </div>
        </div>
        <p className="field-hint" style={{ margin: "6px 0 0" }}>
          Everyone sees name changes straight away — the session name renames
          the canvas for all.
        </p>
        <div className="prop-label" style={{ marginTop: 14 }}>
          In this session — {collabState.peers.length}
        </div>
        <ul className="peer-chips">
          {collabState.peers.map((p) => {
            const at = p.isSelf
              ? null
              : pointers.find((ptr) => ptr.id === p.id) ?? null;
            return (
              <li
                key={p.id}
                className={`peer-chip ${p.away ? "away" : ""} ${at ? "locatable" : ""}`}
                title={at ? `Jump to ${p.name}` : p.away ? `${p.name} — away` : undefined}
                onClick={
                  at
                    ? () => {
                        centerOnPoint({ x: at.x, y: at.y });
                        setDialog(null);
                      }
                    : undefined
                }
              >
                <span className="peer-avatar" style={{ background: p.color }}>
                  {p.name.trim().slice(0, 1) || "?"}
                </span>
                <span className="peer-name">{p.name}</span>
                {p.isSelf && <span className="peer-tag">you</span>}
                {p.away && <span className="peer-tag away">away</span>}
              </li>
            );
          })}
        </ul>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={() => setDialog(null)}>
            Keep drawing
          </button>
          <button
            className="btn btn-outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await collab.leave();
              setBusy(false);
              setDialog(null);
            }}
          >
            <LogOut size={15} /> Leave session
          </button>
          {collabState.isHost && (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await collab.endForEveryone();
                setBusy(false);
                toast("Session ended for everyone", "info");
              }}
            >
              End for everyone
            </button>
          )}
        </div>
      </>
    );
  }

  const start = async () => {
    setError(null);
    if (mode === "password" && password.length < 6) {
      setError("Use at least 6 characters for the session password");
      return;
    }
    setBusy(true);
    try {
      await collab.host(mode, password);
      const link = useStore.getState().collab.shareLink;
      const didCopy = link ? await copy(link) : false;
      toast(
        didCopy
          ? "Session started — link copied to your clipboard"
          : "Session started — copy the link to invite others",
        "success",
      );
    } catch (err) {
      setError(
        err instanceof CollabError || err instanceof ApiError
          ? err.message
          : "Could not start the session",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="dialog-title">Share this canvas</h2>
      <p className="dialog-sub">
        Invite others to draw on “{useStore.getState().sceneTitle}” with you, in
        real time. No account needed on their side.
      </p>
      <div className="e2ee-note">
        <ShieldCheck size={26} style={{ flexShrink: 0 }} />
        <span>
          Still end-to-end encrypted. The session key lives in the link (or your
          password) and never reaches the server — it only relays ciphertext.
        </span>
      </div>
      <div className="field">
        <label htmlFor="share-name">Your name in the session</label>
        <input
          id="share-name"
          value={displayName}
          maxLength={40}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      {saved.length > 0 && (
        <div className="resume-block">
          <div className="prop-label" style={{ marginBottom: 6 }}>
            Rejoin a session you left
          </div>
          <ul className="resume-list">
            {saved.map((r) => (
              <li key={r.roomId}>
                <button
                  className="resume-item"
                  disabled={busy}
                  onClick={() => void resumeSession(r)}
                >
                  <RotateCcw size={15} />
                  <span className="resume-name">{r.title}</span>
                  <span className="resume-when">
                    {r.mode === "password" ? "password" : "link"}
                  </span>
                </button>
                <button
                  className="resume-forget"
                  title="Forget this session"
                  aria-label={`Forget ${r.title}`}
                  disabled={busy}
                  onClick={async () => {
                    await collab.forgetSavedSession(r.roomId);
                    setSaved((list) =>
                      list.filter((x) => x.roomId !== r.roomId),
                    );
                  }}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            Your copy of each canvas is still on this device, so rejoining
            resumes it instead of starting from scratch.
          </p>
        </div>
      )}
      <div className="prop-label" style={{ marginBottom: 6 }}>
        Who can join
      </div>
      <div className="share-mode-row">
        <button
          className={`share-mode ${mode === "link" ? "active" : ""}`}
          onClick={() => setMode("link")}
        >
          <Link2 size={17} />
          <strong>Anyone with the link</strong>
          <span>The key is in the link fragment. Quickest to share.</span>
        </button>
        <button
          className={`share-mode ${mode === "password" ? "active" : ""}`}
          onClick={() => setMode("password")}
        >
          <KeyRound size={17} />
          <strong>Password protected</strong>
          <span>The link alone is useless. Send the password separately.</span>
        </button>
      </div>
      {mode === "password" && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="share-password">Session password</label>
          <input
            id="share-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={() => setDialog(null)}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={start}>
          <Users size={15} />
          {busy ? "Starting…" : "Start session"}
        </button>
      </div>
    </>
  );
};

const JoinDialog = () => {
  const roomId = useStore((s) => s.pendingRoomId);
  const displayName = useStore((s) => s.displayName);
  const setDisplayName = useStore((s) => s.setDisplayName);
  const setDialog = useStore((s) => s.setDialog);
  const setPendingRoomId = useStore((s) => s.setPendingRoomId);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<RoomMode | null>(null);
  const [peers, setPeers] = useState(0);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const secretRef = useRef<string | null>(
    parseRoomHash(window.location.hash)?.secret ?? null,
  );

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void api
      .getRoom(roomId)
      .then((info) => {
        if (cancelled) return;
        setMode(info.mode);
        setPeers(info.peers);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 404
            ? "This session has ended — ask for a fresh link"
            : "Could not reach the session",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const dismiss = () => {
    setPendingRoomId(null);
    setDialog(null);
  };

  const join = async () => {
    if (!roomId) return;
    setError(null);
    setBusy(true);
    try {
      await collab.join(roomId, secretRef.current, password);
      setPendingRoomId(null);
      setDialog(null);
      toast("You're in — say hi with your cursor", "success");
    } catch (err) {
      setError(
        err instanceof CollabError || err instanceof ApiError
          ? err.message
          : "Could not join the session",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="dialog-title">Join this canvas</h2>
      <p className="dialog-sub">
        {loading
          ? "Checking the invitation…"
          : mode === "password"
            ? "This session is password protected. Ask the host for it."
            : `Someone shared a live canvas with you${peers ? ` — ${peers} already drawing` : ""}.`}
      </p>
      <div className="field">
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          value={displayName}
          maxLength={40}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          autoFocus
        />
      </div>
      {mode === "password" && (
        <div className="field">
          <label htmlFor="join-password">Session password</label>
          <input
            id="join-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void join();
            }}
          />
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={dismiss}>
          Not now
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || loading || (!mode && !!error)}
          onClick={join}
        >
          <Users size={15} />
          {busy ? "Joining…" : "Join session"}
        </button>
      </div>
    </>
  );
};

const KeepCopyDialog = () => {
  const setDialog = useStore((s) => s.setDialog);
  const setPendingRoomId = useStore((s) => s.setPendingRoomId);
  const toast = useStore((s) => s.toast);
  const [title, setTitle] = useState(
    () => useStore.getState().sceneTitle.trim() || "Shared canvas",
  );
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState<RoomResume | null>(null);

  useEffect(() => {
    const roomId = collab.resumableRoomId();
    if (!roomId) return;
    let live = true;
    void collab
      .savedSessions()
      .then((all) => {
        if (live) setResume(all.find((r) => r.roomId === roomId) ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const rejoin = async () => {
    if (!resume) return;
    setBusy(true);
    if (resume.mode === "password") {
      setPendingRoomId(resume.roomId);
      setDialog("join");
      return;
    }
    try {
      await collab.rejoin(resume);
      setDialog(null);
      toast("Back in the live session", "success");
    } catch (err) {
      setBusy(false);
      toast(
        err instanceof CollabError || err instanceof ApiError
          ? err.message
          : "Could not rejoin that session",
        "error",
      );
    }
  };

  return (
    <>
      <h2 className="dialog-title">Keep a copy?</h2>
      <p className="dialog-sub">
        You left the live session. Save what you were working on, or drop it and
        go back to your own canvas.
        {resume
          ? " Your copy of this canvas stays on this device, so rejoining picks up where you left off instead of starting over."
          : ""}
      </p>
      <div className="field">
        <label htmlFor="keep-title">Name for the copy</label>
        <input
          id="keep-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          autoFocus
        />
      </div>
      <div className="dialog-actions">
        {resume && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            title="Delete the saved copy of this session from this device"
            onClick={async () => {
              setBusy(true);
              await collab.forgetSavedSession(resume.roomId);
              setResume(null);
              setBusy(false);
            }}
          >
            Forget session
          </button>
        )}
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await collab.discardRoomScene();
            setDialog(null);
          }}
        >
          Discard
        </button>
        {resume && (
          <button className="btn btn-outline" disabled={busy} onClick={rejoin}>
            <Users size={15} /> Rejoin
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await collab.keepRoomSceneCopy(
              title.trim() || "Shared canvas",
            );
            setBusy(false);
            if (!ok) {
              toast(
                "Could not save the copy — you are still on the shared canvas, so try again or export it to a file",
                "error",
              );
              return;
            }
            setDialog(null);
            toast("Saved a copy of the shared canvas", "success");
          }}
        >
          Keep it
        </button>
      </div>
    </>
  );
};

const LeaveLiveDialog = () => {
  const setDialog = useStore((s) => s.setDialog);
  const isHost = useStore((s) => s.collab.isHost);
  const others = useStore((s) => s.collab.peers.filter((p) => !p.isSelf).length);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <h2 className="dialog-title">Leave the live session?</h2>
      <p className="dialog-sub">
        {others
          ? `The session keeps running for the ${others === 1 ? "other person" : `other ${others} people`} — they can carry on drawing without you.`
          : "The session stays open, so anyone with the link can still join and pick up where you left off."}
        {isHost
          ? " To shut it down for everyone instead, use End for everyone."
          : ""}
      </p>
      <div className="dialog-actions">
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            syncManager.queueSceneAfterRoom(null);
            setDialog(null);
          }}
        >
          Stay
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await collab.leave({ silent: true });
            setDialog(null);
          }}
        >
          Leave session
        </button>
      </div>
    </>
  );
};

const formatMegabytes = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "under 0.1 MB";
  if (mb < 10) return `${Math.round(mb * 10) / 10} MB`;
  return `${Math.round(mb)} MB`;
};

const AccountDialog = () => {
  const user = useStore((s) => s.user);
  const scenes = useStore((s) => s.scenes);
  const storage = useStore((s) => s.storage);
  const setDialog = useStore((s) => s.setDialog);
  const setPendingRecoveryCode = useStore((s) => s.setPendingRecoveryCode);
  const toast = useStore((s) => s.toast);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [regen, setRegen] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenError, setRegenError] = useState<string | null>(null);

  if (!user) return null;

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenError(null);
    setBusy(true);
    try {
      const code = await syncManager.regenerateRecoveryCode(regenPassword);
      setRegenPassword("");
      setRegen(false);
      setPendingRecoveryCode(code);
      setDialog("recovery-code");
    } catch (err) {
      setRegenError(
        err instanceof ApiError && err.status === 401
          ? "That password is incorrect"
          : err instanceof ApiError || err instanceof AccountKeyError
            ? err.message
            : "Could not create a new recovery code",
      );
    } finally {
      setBusy(false);
    }
  };

  const usage = storage?.quotaBytes
    ? ` · ${formatMegabytes(storage.sceneBytes)} of ${formatMegabytes(storage.quotaBytes)} used`
    : "";

  return (
    <>
      <h2 className="dialog-title">Account</h2>
      <p className="dialog-sub">
        Signed in as <strong>{user.email}</strong> · {scenes.length} scene
        {scenes.length === 1 ? "" : "s"} synced, end-to-end encrypted{usage}.
      </p>

      <div className="sec-group">
        <div className="sec-label">Security</div>
        <div className="sec-row">
          <div className="sec-row-text">
            <div className="sec-row-title">Password</div>
            <div className="sec-row-desc">
              Changing it keeps all your scenes. You’ll be signed out on your
              other devices.
            </div>
          </div>
          <button
            className="btn btn-outline"
            onClick={() => setDialog("change-password")}
          >
            Change…
          </button>
        </div>
        <div className="sec-row">
          <div className="sec-row-text">
            <div className="sec-row-title">Recovery code</div>
            <div className="sec-row-desc">
              The only way back in if you forget your password. A new code
              replaces the old one.
            </div>
          </div>
          <button
            className="btn btn-outline"
            disabled={regen}
            onClick={() => setRegen(true)}
          >
            New code…
          </button>
        </div>
        {regen && (
          <form onSubmit={regenerate} style={{ paddingTop: 4 }}>
            <div className="field">
              <label htmlFor="regen-pw">
                Confirm your password to create a new code
              </label>
              <input
                id="regen-pw"
                type="password"
                autoComplete="current-password"
                value={regenPassword}
                onChange={(e) => setRegenPassword(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            {regenError && <div className="form-error">{regenError}</div>}
            <div className="dialog-actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setRegen(false);
                  setRegenPassword("");
                  setRegenError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !regenPassword}
                type="submit"
              >
                {busy ? "Working…" : "Create code"}
              </button>
            </div>
          </form>
        )}
      </div>

      <PasskeySection />

      <div className="sec-group">
        <div className="sec-label">This device</div>
        <div className="sec-row">
          <div className="sec-row-text">
            <div className="sec-row-title">Sign out</div>
            <div className="sec-row-desc">
              Clears your encryption key and cached scenes from this browser.
            </div>
          </div>
          <button
            className="btn btn-outline"
            onClick={() => {
              setDialog(null);
              void syncManager.signOut();
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </div>

      <div className="sec-group">
        <div className="sec-label">Danger zone</div>
        <div className="sec-row">
          <div className="sec-row-text">
            <div className="sec-row-title" style={{ color: "var(--danger)" }}>
              {confirmDelete
                ? "This erases every synced scene. Sure?"
                : "Delete account"}
            </div>
            <div className="sec-row-desc">
              Removes your account and all cloud data. This cannot be undone.
            </div>
          </div>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setBusy(true);
              try {
                await syncManager.deleteAccount();
                setDialog(null);
                toast("Account deleted", "info");
              } catch {
                toast("Could not delete account — try again", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmDelete ? "Yes, delete everything" : "Delete…"}
          </button>
        </div>
      </div>
    </>
  );
};
