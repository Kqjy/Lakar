import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "./styles.css";
import { App } from "./App";
import { useStore } from "./store";

if (import.meta.env.DEV) {
  window.addEventListener("lakar-debug", () => {
    const s = useStore.getState();
    document.body.dataset.lakar = JSON.stringify({
      tool: s.activeTool,
      selected: [...s.selectedIds],
      viewport: s.viewport,
      dialog: s.dialog,
      editingText: s.editingTextId,
      user: s.user?.email ?? null,
      syncStatus: s.syncStatus,
      sceneId: s.sceneId,
      sceneTitle: s.sceneTitle,
      scenes: s.scenes.map((sc) => ({
        id: sc.id.slice(0, 6),
        title: sc.title,
        folder: sc.folderId?.slice(0, 6) ?? null,
        v: sc.remoteVersion,
        dirty: sc.dirty,
      })),
      folders: s.folders.map((f) => ({ id: f.id.slice(0, 6), name: f.name })),
      els: s.elements.map((e) => ({
        id: e.id.slice(0, 4),
        type: e.type,
        x: Math.round(e.x),
        y: Math.round(e.y),
        w: Math.round(e.width),
        h: Math.round(e.height),
        angle: Math.round((e.angle * 180) / Math.PI),
        text: "text" in e ? (e as { text: string }).text : undefined,
        containerId:
          "containerId" in e
            ? ((e as { containerId: string | null }).containerId?.slice(0, 4) ?? null)
            : undefined,
        frameId: e.frameId ? e.frameId.slice(0, 4) : undefined,
        name: "name" in e ? (e as { name: string }).name : undefined,
        points: "points" in e ? (e as { points: [number, number][] }).points.length : undefined,
        del: e.isDeleted || undefined,
      })),
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
