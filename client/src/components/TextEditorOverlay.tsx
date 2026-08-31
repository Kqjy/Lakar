import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { TextElement } from "../types";
import { mutateElement, refreshTextDimensions } from "../elements";
import { measureText, FONT_FAMILY_CSS } from "../text/measure";
import { themedColor } from "../colors";
import { history } from "../history";
import { BOUND_PAD, getContainerOf, syncBoundText } from "../boundText";

export const TextEditorOverlay = ({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const editingTextId = useStore((s) => s.editingTextId);
  const elements = useStore((s) => s.elements);
  const el = elements.find(
    (e) => e.id === editingTextId && e.type === "text",
  ) as TextElement | undefined;

  if (!el) return null;
  return <Editor key={el.id} el={el} containerRef={containerRef} />;
};

const Editor = ({
  el,
  containerRef,
}: {
  el: TextElement;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [text, setText] = useState(
    el.containerId ? (el.originalText ?? el.text) : el.text,
  );
  const taRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const viewport = useStore((s) => s.viewport);
  const theme = useStore((s) => s.theme);
  const sceneNonce = useStore((s) => s.sceneNonce);
  void sceneNonce;

  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const s = useStore.getState();
    const finalText = textRef.current.replace(/\s+$/, "");
    const container = getContainerOf(s.elements, el);
    if (!finalText.trim()) {
      mutateElement(el, { isDeleted: true });
      s.clearSelection();
      if (container) s.setSelectedIds([container.id]);
    } else if (container) {
      mutateElement(el, { originalText: finalText });
      syncBoundText(s.elements, container);
    } else {
      mutateElement(el, { text: finalText, originalText: finalText });
      refreshTextDimensions(el, true);
    }
    if (useStore.getState().editingTextId === el.id) {
      s.setEditingText(null);
      if (s.activeTool === "text" && !s.toolLocked) s.setTool("selection");
    }
    s.bumpScene();
    history.commit();
  };

  useLayoutEffect(() => {
    const s = useStore.getState();
    const container = getContainerOf(s.elements, el);
    if (container) {
      mutateElement(el, { originalText: text });
      syncBoundText(s.elements, container);
    } else {
      mutateElement(el, { text, originalText: text });
      refreshTextDimensions(el, true);
    }
    s.bumpScene();
  }, [text, el]);

  const container = getContainerOf(useStore.getState().elements, el);
  const zoom = viewport.zoom;
  let left: number;
  let top: number;
  let width: number;
  let height: number;
  let angle = el.angle;

  if (container) {
    const innerW = Math.max(30, Math.abs(container.width) - BOUND_PAD * 2);
    const wrappedMetrics = measureText(
      el.text || " ",
      el.fontFamily,
      el.fontSize,
      el.lineHeight,
    );
    width = innerW * zoom;
    height = Math.max(wrappedMetrics.height, el.fontSize * el.lineHeight) * zoom + 4;
    const ccx = container.x + container.width / 2;
    const ccy = container.y + container.height / 2;
    left = (ccx - innerW / 2 - viewport.scrollX) * zoom;
    top = (ccy - viewport.scrollY) * zoom - height / 2;
    angle = container.angle;
  } else {
    const metrics = measureText(text || " ", el.fontFamily, el.fontSize, el.lineHeight);
    width = Math.max(metrics.width, el.fontSize) * zoom + 8;
    height = metrics.height * zoom + 4;
    left = (el.x - viewport.scrollX) * zoom;
    top = (el.y - viewport.scrollY) * zoom;
  }

  return (
    <textarea
      ref={taRef}
      className="text-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commit();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      style={{
        left,
        top,
        width,
        height,
        fontFamily: FONT_FAMILY_CSS[el.fontFamily],
        fontSize: el.fontSize * zoom,
        lineHeight: el.lineHeight,
        color: themedColor(el.strokeColor, theme),
        textAlign: el.textAlign,
        opacity: el.opacity / 100,
        whiteSpace: container ? "pre-wrap" : "pre",
        overflowWrap: container ? "break-word" : undefined,
        transform: angle ? `rotate(${angle}rad)` : undefined,
        transformOrigin: "center center",
      }}
    />
  );
};
