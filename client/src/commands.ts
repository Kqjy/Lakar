import { getSelectedElements, useStore } from "./store";
import { history } from "./history";
import {
  alignSelected,
  deleteSelected,
  duplicateSelected,
  groupSelected,
  reorderSelected,
  selectAll,
  distributeSelected,
  toggleLockSelected,
  ungroupSelected,
} from "./interaction/actions";
import { zoomIn, zoomOut, zoomTo100, zoomToFit } from "./interaction/view";
import { exportExcalidrawFile, saveSceneFile } from "./export/json";
import { openFromFile } from "./interaction/fileOps";
import { insertImageFromPicker } from "./interaction/images";
import { syncManager } from "./sync/manager";
import { startPresentation } from "./presentation";
import { TOOL_SHORTCUTS } from "./constants";
import type { ToolType } from "./types";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

const TOOL_LABELS: [ToolType, string][] = [
  ["selection", "Select"],
  ["hand", "Pan"],
  ["rectangle", "Rectangle"],
  ["diamond", "Diamond"],
  ["ellipse", "Ellipse"],
  ["arrow", "Arrow"],
  ["line", "Line"],
  ["freedraw", "Draw"],
  ["text", "Text"],
  ["frame", "Frame"],
  ["laser", "Laser pointer"],
  ["eraser", "Eraser"],
];

const shortcutForTool = (tool: ToolType) => {
  for (const [key, value] of Object.entries(TOOL_SHORTCUTS)) {
    if (value === tool && key.length === 1 && /[a-z]/.test(key)) {
      return key.toUpperCase();
    }
  }
  return undefined;
};

export const buildCommands = (): Command[] => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  const hasSelection = selected.length > 0;
  const multi = selected.length > 1;
  const many = selected.length > 2;
  const out: Command[] = [];

  for (const [tool, label] of TOOL_LABELS) {
    out.push({
      id: `tool.${tool}`,
      label,
      group: "Tool",
      hint: shortcutForTool(tool),
      run: () => useStore.getState().setTool(tool),
    });
  }

  out.push(
    {
      id: "edit.undo",
      label: "Undo",
      group: "Edit",
      hint: "Ctrl+Z",
      run: () => history.undo(),
    },
    {
      id: "edit.redo",
      label: "Redo",
      group: "Edit",
      hint: "Ctrl+Shift+Z",
      run: () => history.redo(),
    },
    {
      id: "edit.selectAll",
      label: "Select all",
      group: "Edit",
      hint: "Ctrl+A",
      run: selectAll,
    },
  );

  if (hasSelection) {
    out.push(
      {
        id: "edit.duplicate",
        label: "Duplicate",
        group: "Edit",
        hint: "Ctrl+D",
        run: () => duplicateSelected(),
      },
      {
        id: "edit.delete",
        label: "Delete selection",
        group: "Edit",
        hint: "Del",
        run: deleteSelected,
      },
      {
        id: "edit.lock",
        label: "Lock / unlock selection",
        group: "Edit",
        run: toggleLockSelected,
      },
      {
        id: "edit.front",
        label: "Bring to front",
        group: "Arrange",
        hint: "Ctrl+Shift+]",
        run: () => reorderSelected("toFront"),
      },
      {
        id: "edit.back",
        label: "Send to back",
        group: "Arrange",
        hint: "Ctrl+Shift+[",
        run: () => reorderSelected("toBack"),
      },
      {
        id: "edit.ungroup",
        label: "Ungroup",
        group: "Arrange",
        hint: "Ctrl+Shift+G",
        run: ungroupSelected,
      },
    );
  }

  if (selected.length === 1) {
    out.push({
      id: "edit.link",
      label: selected[0].link ? "Edit link" : "Add a link",
      group: "Edit",
      run: () => useStore.getState().setLinkEditorId(selected[0].id),
    });
  }

  if (multi) {
    out.push(
      { id: "edit.group", label: "Group", group: "Arrange", hint: "Ctrl+G", run: groupSelected },
      { id: "align.left", label: "Align left", group: "Align", run: () => alignSelected("left") },
      { id: "align.centerH", label: "Align centres horizontally", group: "Align", run: () => alignSelected("center-h") },
      { id: "align.right", label: "Align right", group: "Align", run: () => alignSelected("right") },
      { id: "align.top", label: "Align top", group: "Align", run: () => alignSelected("top") },
      { id: "align.centerV", label: "Align centres vertically", group: "Align", run: () => alignSelected("center-v") },
      { id: "align.bottom", label: "Align bottom", group: "Align", run: () => alignSelected("bottom") },
    );
  }

  if (many) {
    out.push(
      { id: "align.distH", label: "Distribute horizontally", group: "Align", run: () => distributeSelected("h") },
      { id: "align.distV", label: "Distribute vertically", group: "Align", run: () => distributeSelected("v") },
    );
  }

  out.push(
    { id: "view.zoomIn", label: "Zoom in", group: "View", hint: "Ctrl+=", run: zoomIn },
    { id: "view.zoomOut", label: "Zoom out", group: "View", hint: "Ctrl+-", run: zoomOut },
    { id: "view.zoom100", label: "Zoom to 100%", group: "View", hint: "Ctrl+0", run: zoomTo100 },
    { id: "view.zoomFit", label: "Zoom to fit", group: "View", hint: "Shift+1", run: () => zoomToFit() },
    {
      id: "view.grid",
      label: s.gridSize ? "Hide grid" : "Show grid",
      group: "View",
      hint: "Ctrl+'",
      run: () => {
        const st = useStore.getState();
        st.setGridSize(st.gridSize ? null : 20);
      },
    },
    {
      id: "view.snap",
      label: s.snapEnabled ? "Turn off object snapping" : "Turn on object snapping",
      group: "View",
      hint: "Alt+S",
      run: () => {
        const st = useStore.getState();
        st.setSnapEnabled(!st.snapEnabled);
      },
    },
    {
      id: "view.theme",
      label: s.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      group: "View",
      run: () => {
        const st = useStore.getState();
        st.setTheme(st.theme === "dark" ? "light" : "dark");
      },
    },
    {
      id: "view.zen",
      label: s.zenMode ? "Exit zen mode" : "Zen mode",
      group: "View",
      run: () => {
        const st = useStore.getState();
        st.setZenMode(!st.zenMode);
      },
    },
  );

  out.push(
    {
      id: "view.present",
      label: "Present frames as slides",
      group: "View",
      run: startPresentation,
    },
    {
      id: "scene.new",
      label: "New scene",
      group: "Scene",
      run: () => void syncManager.createScene("Untitled scene", null, true),
    },
    {
      id: "scene.browse",
      label: "Browse scenes and folders",
      group: "Scene",
      run: () => useStore.getState().setDialog("scenes"),
    },
    {
      id: "scene.satchel",
      label: "Open the satchel",
      group: "Scene",
      hint: "S",
      run: () => useStore.getState().setSatchelOpen(true),
    },
    {
      id: "scene.mermaid",
      label: "Diagram from text (Mermaid)",
      group: "Scene",
      run: () => useStore.getState().setDialog("mermaid"),
    },
    {
      id: "scene.image",
      label: "Insert image",
      group: "Scene",
      hint: "9",
      run: () => insertImageFromPicker(),
    },
    {
      id: "file.export",
      label: "Export image",
      group: "File",
      hint: "Ctrl+E",
      run: () => useStore.getState().setDialog("export"),
    },
    {
      id: "file.save",
      label: "Save to .lakar file",
      group: "File",
      hint: "Ctrl+S",
      run: () => {
        const st = useStore.getState();
        saveSceneFile(st.elements, st.canvasBg, st.sceneTitle);
      },
    },
    {
      id: "file.excalidraw",
      label: "Export as Excalidraw file",
      group: "File",
      run: () => {
        const st = useStore.getState();
        exportExcalidrawFile(st.elements, st.canvasBg, st.sceneTitle);
      },
    },
    {
      id: "file.open",
      label: "Open a file",
      group: "File",
      hint: "Ctrl+O",
      run: () => void openFromFile(),
    },
    {
      id: "app.share",
      label: "Share for live collaboration",
      group: "App",
      run: () => useStore.getState().setDialog("share"),
    },
    {
      id: "app.publish",
      label: "Publish a read-only page",
      group: "App",
      run: () => useStore.getState().setDialog("publish"),
    },
    {
      id: "app.help",
      label: "Keyboard shortcuts",
      group: "App",
      hint: "?",
      run: () => useStore.getState().setDialog("help"),
    },
  );

  if (!s.user) {
    out.push({
      id: "app.signin",
      label: "Sign in to sync",
      group: "App",
      run: () => useStore.getState().setDialog("auth"),
    });
  } else {
    out.push({
      id: "app.account",
      label: "Account",
      group: "App",
      run: () => useStore.getState().setDialog("account"),
    });
  }

  return out;
};

export const fuzzyScore = (needle: string, haystack: string): number | null => {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const direct = h.indexOf(n);
  if (direct >= 0) return 1000 - direct * 5;
  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const ch of n) {
    const idx = h.indexOf(ch, cursor);
    if (idx < 0) return null;
    streak = idx === cursor ? streak + 1 : 0;
    score += 8 + streak * 4 - Math.min(idx - cursor, 8);
    cursor = idx + 1;
  }
  return score;
};
