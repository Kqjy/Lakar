import { useEffect } from "react";
import { useStore } from "../store";
import { consumeTransfer, hasFiles } from "../interaction/transfer";
import { pasteSmart } from "../interaction/images";

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
};

export const useTransfer = () => {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const s = useStore.getState();
      if (isEditableTarget(e.target)) return;
      if (s.dialog || s.editingTextId || s.viewerMode || s.presenting) return;
      e.preventDefault();
      if (consumeTransfer(e.clipboardData, null)) return;
      void pasteSmart(null);
    };

    const swallow = (e: DragEvent) => {
      if (e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.type === "dragover" && e.dataTransfer) {
        e.dataTransfer.dropEffect = "none";
      }
    };

    document.addEventListener("paste", onPaste);
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);
};
