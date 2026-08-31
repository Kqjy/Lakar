import { useEffect } from "react";
import { useStore } from "./store";
import { CanvasArea } from "./components/CanvasArea";
import { Toolbar } from "./components/Toolbar";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { TopLeft } from "./components/TopLeft";
import { TopRight } from "./components/TopRight";
import { ZoomBar } from "./components/ZoomBar";
import { BottomRight } from "./components/BottomRight";
import { ContextMenu } from "./components/ContextMenu";
import { Palette } from "./components/Palette";
import { PresentBar } from "./components/PresentBar";
import { ViewerChrome } from "./components/ViewerChrome";
import { tryEnterViewerMode } from "./publish";
import { Toasts } from "./components/Toasts";
import { Dialogs } from "./components/Dialogs";
import { ScenesDrawer } from "./components/ScenesDrawer";
import { EmptyHint } from "./components/EmptyHint";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTransfer } from "./hooks/useTransfer";
import { syncManager } from "./sync/manager";
import { SatchelPanel } from "./components/SatchelPanel";
import { parseRoomHash } from "./crypto/room";
import { satchel } from "./satchel/store";
import { collab } from "./collab/manager";

const INVITE_HASH_RE = /^#?invite=((?:LKR-)?[A-Za-z2-9-]{16,24})$/;

const takeInviteFromHash = (hash: string): string | null => {
  const match = INVITE_HASH_RE.exec(hash);
  if (!match) return null;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return match[1].toUpperCase();
};

export const App = () => {
  const theme = useStore((s) => s.theme);
  const presenting = useStore((s) => s.presenting);
  const viewerMode = useStore((s) => s.viewerMode);
  useKeyboard();
  useTransfer();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "dark" ? "#1b1a18" : "#faf9f6");
  }, [theme]);

  useEffect(() => {
    const offerInvite = (roomId: string) => {
      const s = useStore.getState();
      if (collab.currentRoomId() === roomId) return;
      s.setPendingRoomId(roomId);
      s.setDialog("join");
    };

    const offerInviteCode = (code: string) => {
      const s = useStore.getState();
      s.setPendingInviteCode(code);
      if (!s.user && !s.dialog) s.setDialog("auth");
    };

    let cancelled = false;
    void tryEnterViewerMode().then((isViewer) => {
      if (cancelled || isViewer) return;
      const invite = parseRoomHash(window.location.hash);
      const inviteCode = takeInviteFromHash(window.location.hash);
      void syncManager.init().then(() => {
        void satchel.init();
        void collab.savedSessions().catch(() => undefined);
        if (invite) offerInvite(invite.roomId);
        else if (inviteCode) offerInviteCode(inviteCode);
      });
    });

    const onHashChange = () => {
      const next = parseRoomHash(window.location.hash);
      if (next) return offerInvite(next.roomId);
      const code = takeInviteFromHash(window.location.hash);
      if (code) offerInviteCode(code);
    };
    window.addEventListener("hashchange", onHashChange);

    let lastUser = useStore.getState().user;
    const unsubUser = useStore.subscribe((state) => {
      if (state.user === lastUser) return;
      const signedIn = !!state.user && !lastUser;
      lastUser = state.user;
      if (signedIn) void satchel.pullRemote();
      else void satchel.init();
    });

    let lastNonce = useStore.getState().sceneNonce;
    let lastBg = useStore.getState().canvasBg;
    const unsub = useStore.subscribe((state) => {
      if (state.viewerMode) return;
      if (state.sceneNonce !== lastNonce || state.canvasBg !== lastBg) {
        lastNonce = state.sceneNonce;
        lastBg = state.canvasBg;
        syncManager.onSceneMutated();
      }
    });

    const onOnline = () => {
      if (!useStore.getState().viewerMode) syncManager.onOnline();
    };
    const onHide = () => {
      if (useStore.getState().viewerMode) return;
      if (document.visibilityState === "hidden") void syncManager.flushNow();
    };
    const onBeforeUnload = () => {
      if (!useStore.getState().viewerMode) void syncManager.flushNow();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      cancelled = true;
      unsub();
      unsubUser();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return (
    <div className="app">
      <CanvasArea />
      {viewerMode && (
        <div className="ui-layer">
          <ViewerChrome />
        </div>
      )}
      {!presenting && !viewerMode && (
        <>
          <EmptyHint />
          <div className="ui-layer">
            <TopLeft />
            <Toolbar />
            <TopRight />
            <PropertiesPanel />
            <ZoomBar />
            <BottomRight />
          </div>
          <ScenesDrawer />
          <SatchelPanel />
          <ContextMenu />
          <Palette />
          <Dialogs />
        </>
      )}
      <PresentBar />
      <Toasts />
    </div>
  );
};
