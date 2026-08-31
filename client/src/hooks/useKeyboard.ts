import { useEffect, useRef } from "react";
import { getSelectedElements, useStore } from "../store";
import { TOOL_SHORTCUTS } from "../constants";
import { history } from "../history";
import {
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  groupSelected,
  nudgeSelected,
  reorderSelected,
  selectAll,
  ungroupSelected,
} from "../interaction/actions";
import { insertImageFromPicker, pasteSmart } from "../interaction/images";
import { zoomIn, zoomOut, zoomTo100, zoomToFit } from "../interaction/view";
import { saveSceneFile } from "../export/json";
import { openFromFile } from "../interaction/fileOps";
import { isTextElement } from "../types";
import {
  getSlides,
  gotoSlide,
  nextSlide,
  prevSlide,
  stopPresentation,
} from "../presentation";

const isEditableTarget = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable
  );
};

export const useKeyboard = () => {
  const nudgeCommit = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        if (s.presenting) {
          stopPresentation();
          return;
        }
        if (s.palette) {
          s.setPalette(null);
          return;
        }
        if (s.contextMenu) {
          s.setContextMenu(null);
          return;
        }
        if (s.dialog) {
          if (s.dialog !== "keep-collab-copy") s.setDialog(null);
          return;
        }
        if (s.satchelOpen) {
          s.setSatchelOpen(false);
          return;
        }
        if (s.editingTextId) return;
        if (s.selectedIds.size) s.clearSelection();
        return;
      }

      if (s.presenting) {
        if (isEditableTarget(e)) return;
        if (
          e.key === "ArrowRight" ||
          e.key === "ArrowDown" ||
          e.key === " " ||
          e.key === "PageDown" ||
          e.key === "Enter"
        ) {
          e.preventDefault();
          nextSlide();
        } else if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowUp" ||
          e.key === "PageUp" ||
          e.key === "Backspace"
        ) {
          e.preventDefault();
          prevSlide();
        } else if (e.key === "Home") {
          e.preventDefault();
          gotoSlide(0);
        } else if (e.key === "End") {
          e.preventDefault();
          gotoSlide(getSlides(s.elements).length - 1);
        }
        return;
      }

      if (
        s.viewerMode &&
        !(mod && ["=", "+", "-", "0"].includes(e.key))
      ) {
        return;
      }

      if (isEditableTarget(e) || s.dialog || s.editingTextId) return;

      if (mod) {
        const key = e.key.toLowerCase();
        switch (key) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) history.redo();
            else history.undo();
            return;
          case "y":
            e.preventDefault();
            history.redo();
            return;
          case "a":
            e.preventDefault();
            selectAll();
            return;
          case "d":
            e.preventDefault();
            duplicateSelected();
            return;
          case "g":
            e.preventDefault();
            if (e.shiftKey) ungroupSelected();
            else groupSelected();
            return;
          case "c":
            e.preventDefault();
            void copySelected();
            return;
          case "x":
            e.preventDefault();
            void cutSelected();
            return;
          case "v":
            e.preventDefault();
            void pasteSmart(null);
            return;
          case "s":
            e.preventDefault();
            saveSceneFile(s.elements, s.canvasBg, s.sceneTitle);
            return;
          case "o":
            e.preventDefault();
            void openFromFile();
            return;
          case "=":
          case "+":
            e.preventDefault();
            zoomIn();
            return;
          case "-":
            e.preventDefault();
            zoomOut();
            return;
          case "0":
            e.preventDefault();
            zoomTo100();
            return;
          case "]":
            e.preventDefault();
            reorderSelected(e.shiftKey ? "toFront" : "forward");
            return;
          case "[":
            e.preventDefault();
            reorderSelected(e.shiftKey ? "toBack" : "backward");
            return;
          case "e":
            e.preventDefault();
            s.setDialog("export");
            return;
          case "'":
            e.preventDefault();
            s.setGridSize(s.gridSize ? null : 20);
            return;
          case "k":
            e.preventDefault();
            s.setPalette(s.palette === "command" ? null : "command");
            return;
          case "f":
            e.preventDefault();
            s.setPalette(s.palette === "search" ? null : "search");
            return;
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (dx || dy) {
          if (getSelectedElements().length) {
            e.preventDefault();
            nudgeSelected(dx, dy);
            if (nudgeCommit.current) window.clearTimeout(nudgeCommit.current);
            nudgeCommit.current = window.setTimeout(() => {
              history.commit();
              nudgeCommit.current = null;
            }, 350);
          }
          return;
        }
      }

      if (e.key === "Enter") {
        const selected = getSelectedElements();
        if (selected.length === 1 && isTextElement(selected[0])) {
          e.preventDefault();
          s.setEditingText(selected[0].id);
        }
        return;
      }

      if (e.key === "?") {
        s.setDialog("help");
        return;
      }

      if (e.shiftKey && e.key === "!") {
        zoomToFit();
        return;
      }
      if (e.shiftKey && e.key === "@") {
        if (getSelectedElements().length) zoomToFit(true);
        return;
      }

      if (e.key.toLowerCase() === "q") {
        s.setToolLocked(!s.toolLocked);
        return;
      }

      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        s.setSnapEnabled(!s.snapEnabled);
        s.toast(
          s.snapEnabled ? "Object snapping off" : "Object snapping on",
        );
        return;
      }

      if (e.key.toLowerCase() === "s") {
        s.setSatchelOpen(!s.satchelOpen);
        return;
      }

      if (e.key === "9") {
        insertImageFromPicker();
        return;
      }

      if (!e.altKey) {
        const tool = TOOL_SHORTCUTS[e.key.toLowerCase()];
        if (tool) {
          s.setTool(tool);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};
