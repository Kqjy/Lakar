import { useCallback, useEffect, useRef, useState } from "react";
import { getSelectedElements, useStore } from "../store";
import type {
  Bounds,
  FreedrawElement,
  LinearElement,
  Point,
  TextElement,
  LakarElement,
} from "../types";
import {
  isBoundText,
  isContainerElement,
  isFrameElement,
  isLinearLike,
  isTextElement,
} from "../types";
import type { FrameElement } from "../types";
import {
  expandWithFrameMembers,
  nextFrameName,
  refreshFrameMembership,
} from "../frames";
import { LaserManager } from "../interaction/laser";
import {
  currentSlide,
  nextSlide,
  presentationElements,
  prevSlide,
} from "../presentation";
import {
  getBindableAtPoint,
  makeBinding,
  releaseBindingsNotMoving,
  setArrowBinding,
  unbindArrowsFromMissing,
  updateBoundArrows,
  updateBoundPoints,
} from "../binding";
import {
  BOUND_PAD,
  expandWithBoundTexts,
  getBoundText,
  getLooseTextInside,
  syncBoundText,
} from "../boundText";
import { insertImageBlob } from "../interaction/images";
import { setImageLoadNotifier } from "../renderer/imageCache";
import {
  createElement,
  getCommonBounds,
  getElementBounds,
  mutateElement,
  normalizeElement,
  normalizeLinear,
  refreshTextDimensions,
} from "../elements";
import { clamp, distance, rotatePoint } from "../math";
import {
  getContainerAtPosition,
  getElementAtPosition,
  getElementsInBounds,
  getTextAtPosition,
  hitTestElement,
} from "../hitTest";
import {
  getTransformHandles,
  renderInteractiveScene,
  renderStaticScene,
  getRotatedBoundsUnrotated,
  type HandleKind,
} from "../renderer/renderScene";
import {
  computeResize,
  cursorForHandle,
  fixCenterAfterRotatedResize,
  scaleElementFromSnapshot,
  snapshotElement,
  type ElementSnapshot,
} from "../interaction/resize";
import { getLinkedElements, hitLinkBadge, isSceneLink } from "../links";
import { openLink } from "../interaction/linkActions";
import { LinkEditor } from "./LinkEditor";
import { expandToGroups, duplicateSelected } from "../interaction/actions";
import {
  computeSnap,
  snapPointToGrid,
  type SnapGuide,
} from "../interaction/snap";
import { history } from "../history";
import {
  MAX_EDITABLE_POINTS,
  MAX_ZOOM,
  MIN_ZOOM,
  TEXT_LINE_HEIGHT,
} from "../constants";
import { TextEditorOverlay } from "./TextEditorOverlay";
import { collab } from "../collab/manager";
import { presence } from "../collab/presence";
import { CollabCursors } from "./CollabCursors";
import { SATCHEL_DRAG_TYPE } from "./SatchelPanel";
import { getBuiltInItems, satchel } from "../satchel/store";

type Session =
  | { kind: "panning"; lastX: number; lastY: number; prevTool: string | null }
  | { kind: "drawing-shape"; el: LakarElement; start: Point; alt: boolean; shift: boolean }
  | { kind: "drawing-linear"; el: LinearElement; start: Point; moved: boolean; shift: boolean }
  | { kind: "freedraw"; el: FreedrawElement }
  | {
      kind: "moving";
      snapshots: Map<string, { x: number; y: number }>;
      bounds: Bounds;
      start: Point;
      moved: boolean;
      shift: boolean;
      released: boolean;
    }
  | {
      kind: "resizing";
      handle: HandleKind;
      snapshots: ElementSnapshot[];
      originalBounds: Bounds;
      angle: number;
      center: Point;
      isText: boolean;
    }
  | {
      kind: "rotating";
      center: Point;
      startPointerAngle: number;
      snapshots: Map<string, { angle: number; cx: number; cy: number }>;
    }
  | {
      kind: "point-drag";
      el: LinearElement;
      index: number;
      start: Point;
      orig: [number, number];
    }
  | { kind: "rubber"; start: Point; current: Point; prevSelection: string[] }
  | { kind: "erasing"; last: Point }
  | { kind: "laser" }
  | null;

const DRAG_THRESHOLD = 3;

interface PinchState {
  dist: number;
  midX: number;
  midY: number;
  zoom: number;
  scrollX: number;
  scrollY: number;
}

export const CanvasArea = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const interactiveRef = useRef<HTMLCanvasElement>(null);
  const laserRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const sessionRef = useRef<Session>(null);
  const multiPointRef = useRef<LinearElement | null>(null);
  const spaceRef = useRef(false);
  const renderScheduled = useRef(0);
  const lastPointerRef = useRef<Point>({ x: 0, y: 0 });
  const laserMgrRef = useRef<LaserManager | null>(null);
  const bindHighlightRef = useRef<string | null>(null);
  const snapGuidesRef = useRef<SnapGuide[]>([]);
  const pointersRef = useRef(
    new Map<number, { x: number; y: number; type: string }>(),
  );
  const pinchRef = useRef<PinchState | null>(null);
  const penActiveRef = useRef(false);
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);

  const clientToScene = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const { viewport } = useStore.getState();
    return {
      x: viewport.scrollX + (clientX - rect.left) / viewport.zoom,
      y: viewport.scrollY + (clientY - rect.top) / viewport.zoom,
    };
  }, []);

  const scheduleRender = useCallback(() => {
    if (renderScheduled.current) return;
    renderScheduled.current = requestAnimationFrame(() => {
      renderScheduled.current = 0;
      const s = useStore.getState();
      const { w, h, dpr } = sizeRef.current;
      const staticCanvas = staticRef.current;
      const interactiveCanvas = interactiveRef.current;
      if (!staticCanvas || !interactiveCanvas || !w || !h) return;

      const elements = s.presenting
        ? presentationElements(s.elements, currentSlide())
        : s.editingTextId
          ? s.elements.filter((el) => el.id !== s.editingTextId)
          : s.elements;

      renderStaticScene({
        canvas: staticCanvas,
        elements,
        viewport: s.viewport,
        theme: s.theme,
        canvasBg: s.canvasBg,
        pendingEraseIds: s.pendingEraseIds,
        gridSize: s.gridSize,
        width: w,
        height: h,
        dpr,
      });

      const session = sessionRef.current;
      const selected = getSelectedElements();
      const single = selected.length === 1 ? selected[0] : null;
      const editingLinear =
        single &&
        isLinearLike(single) &&
        single.type !== "freedraw" &&
        single.points.length <= MAX_EDITABLE_POINTS
          ? single
          : null;
      let rubberBand: Bounds | null = null;
      if (session?.kind === "rubber") {
        rubberBand = {
          minX: Math.min(session.start.x, session.current.x),
          minY: Math.min(session.start.y, session.current.y),
          maxX: Math.max(session.start.x, session.current.x),
          maxY: Math.max(session.start.y, session.current.y),
        };
      }
      const hideHandles =
        session?.kind === "drawing-shape" ||
        session?.kind === "drawing-linear" ||
        session?.kind === "freedraw" ||
        session?.kind === "erasing" ||
        !!multiPointRef.current;

      const pointers = presence.getPointers();
      let remoteSelections: { color: string; elements: LakarElement[] }[] = [];
      if (pointers.length) {
        const byId = new Map(
          s.elements.filter((el) => !el.isDeleted).map((el) => [el.id, el]),
        );
        remoteSelections = pointers
          .map((p) => ({
            color: p.color,
            elements: p.selectedIds
              .map((id) => byId.get(id))
              .filter((el): el is LakarElement => !!el),
          }))
          .filter((entry) => entry.elements.length > 0);
      }

      const highlightId = bindHighlightRef.current;
      const bindingHighlight = highlightId
        ? s.elements.find((el) => el.id === highlightId && !el.isDeleted) ?? null
        : null;

      renderInteractiveScene({
        canvas: interactiveCanvas,
        selectedElements: s.presenting
          ? []
          : s.editingTextId
            ? selected.filter((el) => el.id !== s.editingTextId)
            : selected,
        viewport: s.viewport,
        theme: s.theme,
        width: w,
        height: h,
        dpr,
        rubberBand: s.presenting ? null : rubberBand,
        editingLinear: s.presenting ? null : editingLinear,
        hideHandles: s.presenting || hideHandles,
        hideRotation: selected.some(isFrameElement),
        remoteSelections: s.presenting ? [] : remoteSelections,
        bindingHighlight: s.presenting ? null : bindingHighlight,
        snapGuides: s.presenting ? [] : snapGuidesRef.current,
        linkedElements: getLinkedElements(elements),
      });
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current!;
    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      for (const canvas of [staticRef.current!, interactiveRef.current!, laserRef.current!]) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      scheduleRender();
    };
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [scheduleRender]);

  useEffect(() => {
    const unsub = useStore.subscribe(scheduleRender);
    const unsubPresence = presence.subscribe(scheduleRender);
    scheduleRender();
    return () => {
      unsub();
      unsubPresence();
      cancelAnimationFrame(renderScheduled.current);
      renderScheduled.current = 0;
    };
  }, [scheduleRender]);

  useEffect(() => {
    let lastSelection = useStore.getState().selectedIds;
    return useStore.subscribe((state) => {
      if (state.selectedIds !== lastSelection) {
        lastSelection = state.selectedIds;
        collab.onSelectionChanged();
      }
    });
  }, []);

  useEffect(() => {
    setImageLoadNotifier(() => useStore.getState().bumpScene());
    return () => setImageLoadNotifier(null);
  }, []);

  useEffect(() => {
    const mgr = new LaserManager();
    laserMgrRef.current = mgr;
    mgr.attach(
      laserRef.current!,
      () => useStore.getState().viewport,
      () => sizeRef.current,
    );
    return () => {
      mgr.detach();
      laserMgrRef.current = null;
    };
  }, []);

  useEffect(() => {
    let running = false;
    const run = () => {
      if (running) return;
      running = true;
      const s = useStore.getState();
      let dirty = refreshFrameMembership(s.elements);
      if (unbindArrowsFromMissing(s.elements)) dirty = true;
      if (dirty) s.bumpScene();
      running = false;
    };
    let lastNonce = useStore.getState().sceneNonce;
    const unsub = useStore.subscribe((state) => {
      if (state.sceneNonce === lastNonce) return;
      run();
      lastNonce = useStore.getState().sceneNonce;
    });
    run();
    return unsub;
  }, []);

  useEffect(() => {
    const container = containerRef.current!;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes(SATCHEL_DRAG_TYPE)) {
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const p = clientToScene(e.clientX, e.clientY);
      const itemId = e.dataTransfer?.getData(SATCHEL_DRAG_TYPE);
      if (itemId) {
        const item =
          useStore.getState().satchelItems.find((i) => i.id === itemId) ??
          getBuiltInItems().find((i) => i.id === itemId);
        if (item) satchel.place(item, p);
        return;
      }
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          void insertImageBlob(file, p);
          return;
        }
      }
      useStore.getState().toast("Drop an image file, or use Open… for scenes", "info");
    };
    container.addEventListener("dragover", onDragOver);
    container.addEventListener("drop", onDrop);
    return () => {
      container.removeEventListener("dragover", onDragOver);
      container.removeEventListener("drop", onDrop);
    };
  }, [clientToScene]);

  const finishMultiPoint = useCallback(
    (cancelLast: boolean) => {
      const el = multiPointRef.current;
      if (!el) return;
      multiPointRef.current = null;
      const s = useStore.getState();
      let points = el.points.map((p) => [...p] as [number, number]);
      if (cancelLast && points.length > 1) points = points.slice(0, -1);
      while (
        points.length > 1 &&
        distance(
          { x: points[points.length - 1][0], y: points[points.length - 1][1] },
          { x: points[points.length - 2][0], y: points[points.length - 2][1] },
        ) < 1
      ) {
        points = points.slice(0, -1);
      }
      if (points.length < 2) {
        mutateElement(el, { isDeleted: true });
        s.bumpScene();
        history.commit();
        if (!s.toolLocked) s.setTool("selection");
        return;
      }
      mutateElement(el, { points } as Partial<LinearElement>);
      if (el.type === "arrow") {
        const tip = {
          x: el.x + points[points.length - 1][0],
          y: el.y + points[points.length - 1][1],
        };
        const target = getBindableAtPoint(
          s.elements,
          tip,
          s.viewport.zoom,
          new Set([el.id]),
        );
        setArrowBinding(el, "end", target ? makeBinding(target, tip) : null);
        updateBoundPoints(new Map(s.elements.map((x) => [x.id, x])), el);
      }
      bindHighlightRef.current = null;
      normalizeLinear(el);
      s.bumpScene();
      history.commit();
      if (!s.toolLocked) {
        s.setTool("selection");
        s.setSelectedIds([el.id]);
      }
    },
    [],
  );

  useEffect(() => {
    let prevTool = useStore.getState().activeTool;
    return useStore.subscribe((state) => {
      if (state.activeTool !== prevTool) {
        prevTool = state.activeTool;
        if (multiPointRef.current) finishMultiPoint(true);
      }
    });
  }, [finishMultiPoint]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
          spaceRef.current = true;
          if (!sessionRef.current) setCursor("grab");
        }
      }
      if (multiPointRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          finishMultiPoint(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finishMultiPoint(true);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        if (!sessionRef.current) updateHoverCursor(lastPointerRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  useEffect(() => {
    const container = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useStore.getState();
      if (s.presenting) return;
      const rect = container.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0018);
        s.zoomAt(
          s.viewport.zoom * factor,
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        s.setViewport({
          scrollX: s.viewport.scrollX + dx / s.viewport.zoom,
          scrollY: s.viewport.scrollY + dy / s.viewport.zoom,
        });
      }
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const setCursor = (cursor: string) => {
    if (containerRef.current) containerRef.current.style.cursor = cursor;
  };

  const touchPoints = () =>
    [...pointersRef.current.values()].filter((p) => p.type === "touch");

  const abortSession = () => {
    const session = sessionRef.current;
    const s = useStore.getState();
    if (multiPointRef.current) {
      mutateElement(multiPointRef.current, { isDeleted: true });
      multiPointRef.current = null;
      s.bumpScene();
    }
    if (session) {
      if (
        session.kind === "drawing-shape" ||
        session.kind === "drawing-linear" ||
        session.kind === "freedraw"
      ) {
        mutateElement(session.el, { isDeleted: true });
        s.bumpScene();
      }
      if (session.kind === "erasing") s.setPendingErase([]);
      if (session.kind === "laser") laserMgrRef.current?.end();
    }
    sessionRef.current = null;
    snapGuidesRef.current = [];
    bindHighlightRef.current = null;
  };

  const startPinch = () => {
    const [a, b] = touchPoints();
    if (!a || !b) return;
    const s = useStore.getState();
    pinchRef.current = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      zoom: s.viewport.zoom,
      scrollX: s.viewport.scrollX,
      scrollY: s.viewport.scrollY,
    };
  };

  const updatePinch = () => {
    const start = pinchRef.current;
    const [a, b] = touchPoints();
    if (!start || !a || !b) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const zoom = clamp(start.zoom * (dist / start.dist), MIN_ZOOM, MAX_ZOOM);
    const sceneX = start.scrollX + (start.midX - rect.left) / start.zoom;
    const sceneY = start.scrollY + (start.midY - rect.top) / start.zoom;
    useStore.getState().setViewport({
      zoom,
      scrollX: sceneX - (midX - rect.left) / zoom,
      scrollY: sceneY - (midY - rect.top) / zoom,
    });
  };

  const setBindHighlight = (id: string | null) => {
    if (bindHighlightRef.current === id) return;
    bindHighlightRef.current = id;
    scheduleRender();
  };

  const applyBindingAt = (
    el: LinearElement,
    which: "start" | "end",
    at: Point,
    suppress: boolean,
  ) => {
    if (el.type !== "arrow") {
      setBindHighlight(null);
      return;
    }
    if (suppress) {
      setArrowBinding(el, which, null);
      setBindHighlight(null);
      return;
    }
    const s = useStore.getState();
    const target = getBindableAtPoint(
      s.elements,
      at,
      s.viewport.zoom,
      new Set([el.id]),
    );
    setArrowBinding(el, which, target ? makeBinding(target, at) : null);
    setBindHighlight(target ? target.id : null);
  };

  const reclipArrow = (el: LinearElement) => {
    const s = useStore.getState();
    updateBoundPoints(new Map(s.elements.map((x) => [x.id, x])), el);
  };

  const hitHandle = (p: Point): HandleKind | null => {
    const s = useStore.getState();
    const selected = getSelectedElements();
    if (!selected.length || s.activeTool !== "selection") return null;
    const zoom = s.viewport.zoom;
    let bounds: Bounds;
    let angle = 0;
    if (selected.length === 1) {
      if (isLinearLike(selected[0]) && selected[0].type !== "freedraw") return null;
      bounds = getRotatedBoundsUnrotated(selected[0]);
      angle = selected[0].angle;
    } else {
      bounds = getCommonBounds(selected);
    }
    const noRotation = selected.some(isFrameElement);
    const handles = getTransformHandles(bounds, angle, zoom);
    const grab = 8 / zoom;
    for (const h of handles) {
      if (noRotation && h.kind === "rotation") continue;
      if (Math.hypot(p.x - h.x, p.y - h.y) <= grab) return h.kind;
    }
    return null;
  };

  const hitLinearPoint = (p: Point): { el: LinearElement; index: number } | null => {
    const s = useStore.getState();
    const selected = getSelectedElements();
    if (
      selected.length !== 1 ||
      !isLinearLike(selected[0]) ||
      selected[0].type === "freedraw" ||
      selected[0].points.length > MAX_EDITABLE_POINTS ||
      s.activeTool !== "selection"
    )
      return null;
    const el = selected[0] as LinearElement;
    const zoom = s.viewport.zoom;
    const grab = 9 / zoom;
    const b = getRotatedBoundsUnrotated(el);
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    for (let i = 0; i < el.points.length; i++) {
      const pt = rotatePoint(
        { x: el.x + el.points[i][0], y: el.y + el.points[i][1] },
        c,
        el.angle,
      );
      if (Math.hypot(p.x - pt.x, p.y - pt.y) <= grab) return { el, index: i };
    }
    return null;
  };

  const updateHoverCursor = (p: Point) => {
    const s = useStore.getState();
    if (spaceRef.current || s.activeTool === "hand") {
      setCursor("grab");
      return;
    }
    if (s.activeTool === "selection") {
      if (hitLinkBadge(useStore.getState().elements, p, s.viewport.zoom)) {
        setCursor("pointer");
        return;
      }
      const handle = hitHandle(p);
      if (handle) {
        const selected = getSelectedElements();
        const angle = selected.length === 1 ? selected[0].angle : 0;
        setCursor(cursorForHandle(handle, angle));
        return;
      }
      if (hitLinearPoint(p)) {
        setCursor("pointer");
        return;
      }
      const el = getElementAtPosition(useStore.getState().elements, p, s.viewport.zoom);
      setCursor(el ? "move" : "default");
      return;
    }
    if (s.activeTool === "text") {
      setCursor("text");
      return;
    }
    if (s.activeTool === "eraser") {
      setCursor("crosshair");
      return;
    }
    setCursor("crosshair");
  };

  const startTextEditing = (scenePoint: Point, existing: TextElement | null) => {
    const s = useStore.getState();
    if (existing) {
      s.setSelectedIds([existing.id]);
      s.setEditingText(existing.id);
      return;
    }
    const el = createElement({
      type: "text",
      x: scenePoint.x,
      y: scenePoint.y - (s.itemDefaults.fontSize * TEXT_LINE_HEIGHT) / 2,
      defaults: s.itemDefaults,
    }) as TextElement;
    el.lineHeight = TEXT_LINE_HEIGHT;
    refreshTextDimensions(el);
    s.replaceElements([...s.elements, el]);
    s.setSelectedIds([el.id]);
    s.setEditingText(el.id);
  };

  const startBoundTextEditing = (container: LakarElement, at?: Point) => {
    const s = useStore.getState();
    let textEl = getBoundText(s.elements, container.id);
    if (!textEl) {
      const loose = getLooseTextInside(s.elements, container, at);
      if (loose) {
        s.setSelectedIds([loose.id]);
        s.setEditingText(loose.id);
        return;
      }
      textEl = createElement({
        type: "text",
        x: container.x + container.width / 2,
        y: container.y + container.height / 2,
        defaults: s.itemDefaults,
      }) as TextElement;
      mutateElement(textEl, {
        containerId: container.id,
        textAlign: "center",
        originalText: "",
        lineHeight: TEXT_LINE_HEIGHT,
        angle: container.angle,
      });
      s.replaceElements([...s.elements, textEl]);
      syncBoundText(useStore.getState().elements, container);
      s.bumpScene();
    }
    s.setSelectedIds([textEl.id]);
    s.setEditingText(textEl.id);
  };

  const eraseAt = (p: Point, prev: Point | null) => {
    const s = useStore.getState();
    const zoom = s.viewport.zoom;
    const next = new Set(s.pendingEraseIds);
    const testPoints: Point[] = [p];
    if (prev) {
      const d = distance(prev, p);
      const steps = Math.min(24, Math.floor(d / (6 / zoom)));
      for (let i = 1; i < steps; i++) {
        testPoints.push({
          x: prev.x + ((p.x - prev.x) * i) / steps,
          y: prev.y + ((p.y - prev.y) * i) / steps,
        });
      }
    }
    let changed = false;
    for (const el of s.elements) {
      if (el.isDeleted || el.locked || next.has(el.id) || isBoundText(el)) continue;
      for (const tp of testPoints) {
        if (hitTestElement(el, tp, zoom)) {
          next.add(el.id);
          changed = true;
          break;
        }
      }
    }
    if (changed) s.setPendingErase(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType,
    });
    if (e.pointerType === "pen") penActiveRef.current = true;
    if (e.pointerType === "touch" && penActiveRef.current) return;
    if (touchPoints().length >= 2) {
      abortSession();
      startPinch();
      scheduleRender();
      return;
    }
    if (s.presenting) {
      if (e.button !== 0) return;
      const at = clientToScene(e.clientX, e.clientY);
      const linked = hitLinkBadge(s.elements, at, s.viewport.zoom);
      if (linked?.link) {
        openLink(linked.link);
        return;
      }
      nextSlide();
      return;
    }
    if (s.viewerMode) {
      if (e.button === 2) return;
      const at = clientToScene(e.clientX, e.clientY);
      const linked = hitLinkBadge(s.elements, at, s.viewport.zoom);
      if (linked?.link && !isSceneLink(linked.link)) {
        openLink(linked.link);
        return;
      }
      try {
        containerRef.current!.setPointerCapture(e.pointerId);
      } catch {
        void 0;
      }
      sessionRef.current = {
        kind: "panning",
        lastX: e.clientX,
        lastY: e.clientY,
        prevTool: null,
      };
      setCursor("grabbing");
      return;
    }
    if (s.contextMenu) s.setContextMenu(null);
    if (e.button === 2) return;
    const container = containerRef.current!;
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      void 0;
    }
    const p = clientToScene(e.clientX, e.clientY);

    if (e.button === 1 || spaceRef.current || s.activeTool === "hand") {
      sessionRef.current = {
        kind: "panning",
        lastX: e.clientX,
        lastY: e.clientY,
        prevTool: null,
      };
      setCursor("grabbing");
      return;
    }
    if (e.button !== 0) return;

    if (!multiPointRef.current && s.activeTool === "selection") {
      const linked = hitLinkBadge(s.elements, p, s.viewport.zoom);
      if (linked?.link) {
        e.preventDefault();
        openLink(linked.link);
        return;
      }
    }

    if (multiPointRef.current) {
      const el = multiPointRef.current;
      const last = el.points[el.points.length - 1];
      mutateElement(el, {
        points: [...el.points, [last[0], last[1]]],
      } as Partial<LinearElement>);
      s.bumpScene();
      return;
    }

    const tool = s.activeTool;

    if (tool === "laser") {
      e.preventDefault();
      laserMgrRef.current?.start(p);
      sessionRef.current = { kind: "laser" };
      return;
    }

    if (tool === "frame") {
      const el = createElement({
        type: "frame",
        x: p.x,
        y: p.y,
        defaults: s.itemDefaults,
      }) as FrameElement;
      mutateElement(el, { name: nextFrameName(s.elements), opacity: 100 });
      s.replaceElements([...s.elements, el]);
      sessionRef.current = {
        kind: "drawing-shape",
        el,
        start: p,
        alt: e.altKey,
        shift: e.shiftKey,
      };
      return;
    }

    if (tool === "selection") {
      const handle = hitHandle(p);
      if (handle === "rotation") {
        const selected = getSelectedElements();
        const bounds =
          selected.length === 1
            ? getRotatedBoundsUnrotated(selected[0])
            : getCommonBounds(selected);
        const center = {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        };
        sessionRef.current = {
          kind: "rotating",
          center,
          startPointerAngle: Math.atan2(p.y - center.y, p.x - center.x),
          snapshots: new Map(
            selected.map((el) => {
              const b = getRotatedBoundsUnrotated(el);
              return [
                el.id,
                {
                  angle: el.angle,
                  cx: (b.minX + b.maxX) / 2,
                  cy: (b.minY + b.maxY) / 2,
                },
              ];
            }),
          ),
        };
        setCursor("grabbing");
        return;
      }
      if (handle) {
        const selected = getSelectedElements();
        const single = selected.length === 1 ? selected[0] : null;
        const bounds = single
          ? getRotatedBoundsUnrotated(single)
          : getCommonBounds(selected);
        sessionRef.current = {
          kind: "resizing",
          handle,
          snapshots: selected.map(snapshotElement),
          originalBounds: bounds,
          angle: single ? single.angle : 0,
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          isText: !!single && isTextElement(single),
        };
        return;
      }
      const linearPoint = hitLinearPoint(p);
      if (linearPoint) {
        sessionRef.current = {
          kind: "point-drag",
          el: linearPoint.el,
          index: linearPoint.index,
          start: p,
          orig: [...linearPoint.el.points[linearPoint.index]] as [number, number],
        };
        return;
      }

      const hitEl = getElementAtPosition(s.elements, p, s.viewport.zoom);
      if (hitEl) {
        let nextSelection: Set<string>;
        const expanded = e.ctrlKey || e.metaKey
          ? new Set([hitEl.id])
          : expandToGroups(s.elements, [hitEl.id]);
        if (e.shiftKey) {
          nextSelection = new Set(s.selectedIds);
          const allIn = [...expanded].every((id) => nextSelection.has(id));
          if (allIn) {
            for (const id of expanded) nextSelection.delete(id);
            s.setSelectedIds(nextSelection);
            return;
          }
          for (const id of expanded) nextSelection.add(id);
        } else if (s.selectedIds.has(hitEl.id)) {
          nextSelection = new Set(s.selectedIds);
        } else {
          nextSelection = expanded;
        }
        s.setSelectedIds(nextSelection);
        const selected = getSelectedElements();
        const movable = selected.filter((el) => !el.locked);
        if (e.altKey && movable.length) {
          duplicateSelected(0);
        }
        const moveIds = expandWithFrameMembers(
          s.elements,
          getSelectedElements().map((el) => el.id),
        );
        const movingEls = useStore
          .getState()
          .elements.filter((el) => !el.isDeleted && moveIds.has(el.id));
        sessionRef.current = {
          kind: "moving",
          snapshots: new Map(movingEls.map((el) => [el.id, { x: el.x, y: el.y }])),
          bounds: getCommonBounds(movingEls),
          start: p,
          moved: false,
          shift: e.shiftKey,
          released: false,
        };
        return;
      }

      sessionRef.current = {
        kind: "rubber",
        start: p,
        current: p,
        prevSelection: e.shiftKey ? [...s.selectedIds] : [],
      };
      if (!e.shiftKey && s.selectedIds.size) s.clearSelection();
      scheduleRender();
      return;
    }

    if (tool === "text") {
      if (s.editingTextId) return;
      e.preventDefault();
      const hitEl = getElementAtPosition(s.elements, p, s.viewport.zoom);
      startTextEditing(p, hitEl && isTextElement(hitEl) ? hitEl : null);
      return;
    }

    if (tool === "eraser") {
      sessionRef.current = { kind: "erasing", last: p };
      eraseAt(p, null);
      return;
    }

    if (tool === "freedraw") {
      const el = createElement({
        type: "freedraw",
        x: p.x,
        y: p.y,
        defaults: s.itemDefaults,
      }) as FreedrawElement;
      el.pressures = [e.pressure || 0.5];
      s.replaceElements([...s.elements, el]);
      sessionRef.current = { kind: "freedraw", el };
      return;
    }

    if (tool === "line" || tool === "arrow") {
      const el = createElement({
        type: tool,
        x: p.x,
        y: p.y,
        defaults: s.itemDefaults,
      }) as LinearElement;
      mutateElement(el, { points: [[0, 0], [0, 0]] } as Partial<LinearElement>);
      s.replaceElements([...s.elements, el]);
      if (tool === "arrow" && !(e.ctrlKey || e.metaKey)) {
        const target = getBindableAtPoint(
          s.elements,
          p,
          s.viewport.zoom,
          new Set([el.id]),
        );
        if (target) setArrowBinding(el, "start", makeBinding(target, p));
      }
      sessionRef.current = {
        kind: "drawing-linear",
        el,
        start: p,
        moved: false,
        shift: e.shiftKey,
      };
      return;
    }

    if (tool === "rectangle" || tool === "diamond" || tool === "ellipse") {
      const start = snapPointToGrid(p.x, p.y, s.gridSize);
      const el = createElement({
        type: tool,
        x: start.x,
        y: start.y,
        defaults: s.itemDefaults,
      });
      s.replaceElements([...s.elements, el]);
      sessionRef.current = {
        kind: "drawing-shape",
        el,
        start,
        alt: e.altKey,
        shift: e.shiftKey,
      };
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
      });
    }
    if (pinchRef.current) {
      updatePinch();
      return;
    }
    if (e.pointerType === "touch" && penActiveRef.current) return;
    if (s.presenting) {
      const at = clientToScene(e.clientX, e.clientY);
      setCursor(
        hitLinkBadge(s.elements, at, s.viewport.zoom) ? "pointer" : "default",
      );
      return;
    }
    const p = clientToScene(e.clientX, e.clientY);
    lastPointerRef.current = p;
    if (s.viewerMode) {
      const session = sessionRef.current;
      if (session?.kind === "panning") {
        s.setViewport({
          scrollX: s.viewport.scrollX - (e.clientX - session.lastX) / s.viewport.zoom,
          scrollY: s.viewport.scrollY - (e.clientY - session.lastY) / s.viewport.zoom,
        });
        session.lastX = e.clientX;
        session.lastY = e.clientY;
        return;
      }
      const linked = hitLinkBadge(s.elements, p, s.viewport.zoom);
      setCursor(linked && !isSceneLink(linked.link!) ? "pointer" : "grab");
      return;
    }
    collab.onPointerMove(p);
    const session = sessionRef.current;

    if (!session) {
      if (multiPointRef.current) {
        const el = multiPointRef.current;
        const points = el.points.map((pt) => [...pt] as [number, number]);
        let dx = p.x - el.x;
        let dy = p.y - el.y;
        if (e.shiftKey && points.length >= 2) {
          const prev = points[points.length - 2];
          const snapped = snapAngle(dx - prev[0], dy - prev[1]);
          dx = prev[0] + snapped.x;
          dy = prev[1] + snapped.y;
        }
        points[points.length - 1] = [dx, dy];
        mutateElement(el, { points } as Partial<LinearElement>);
        applyBindingAt(
          el,
          "end",
          { x: el.x + dx, y: el.y + dy },
          e.ctrlKey || e.metaKey,
        );
        reclipArrow(el);
        s.bumpScene();
        return;
      }
      updateHoverCursor(p);
      return;
    }

    switch (session.kind) {
      case "panning": {
        const dx = e.clientX - session.lastX;
        const dy = e.clientY - session.lastY;
        session.lastX = e.clientX;
        session.lastY = e.clientY;
        s.setViewport({
          scrollX: s.viewport.scrollX - dx / s.viewport.zoom,
          scrollY: s.viewport.scrollY - dy / s.viewport.zoom,
        });
        break;
      }
      case "drawing-shape": {
        const el = session.el;
        const drawSnap = computeSnap(
          s.elements,
          new Set([el.id]),
          { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
          s.viewport.zoom,
          s.gridSize,
          s.snapEnabled && !(e.ctrlKey || e.metaKey),
        );
        snapGuidesRef.current = drawSnap.guides;
        const corner = { x: p.x + drawSnap.dx, y: p.y + drawSnap.dy };
        let w = corner.x - session.start.x;
        let h = corner.y - session.start.y;
        if (e.shiftKey || session.shift) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        if (e.altKey || session.alt) {
          mutateElement(el, {
            x: session.start.x - Math.abs(w),
            y: session.start.y - Math.abs(h),
            width: Math.abs(w) * 2,
            height: Math.abs(h) * 2,
          } as Partial<LakarElement>);
        } else {
          mutateElement(el, {
            x: session.start.x,
            y: session.start.y,
            width: w,
            height: h,
          } as Partial<LakarElement>);
        }
        s.bumpScene();
        break;
      }
      case "drawing-linear": {
        const el = session.el;
        let dx = p.x - session.start.x;
        let dy = p.y - session.start.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD / s.viewport.zoom) {
          session.moved = true;
        }
        if (e.shiftKey) {
          const snapped = snapAngle(dx, dy);
          dx = snapped.x;
          dy = snapped.y;
        }
        mutateElement(el, {
          x: session.start.x,
          y: session.start.y,
          points: [[0, 0], [dx, dy]],
        } as Partial<LinearElement>);
        applyBindingAt(
          el,
          "end",
          { x: session.start.x + dx, y: session.start.y + dy },
          e.ctrlKey || e.metaKey,
        );
        reclipArrow(el);
        s.bumpScene();
        break;
      }
      case "freedraw": {
        const el = session.el;
        const dx = p.x - el.x;
        const dy = p.y - el.y;
        mutateElement(el, {
          points: [...el.points, [dx, dy]],
          pressures: [...el.pressures, e.pressure || 0.5],
        } as Partial<FreedrawElement>);
        s.bumpScene();
        break;
      }
      case "moving": {
        let dx = p.x - session.start.x;
        let dy = p.y - session.start.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD / s.viewport.zoom) {
          session.moved = true;
        }
        if (!session.moved) break;
        if (!session.released) {
          session.released = true;
          releaseBindingsNotMoving(s.elements, new Set(session.snapshots.keys()));
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const snap = computeSnap(
          s.elements,
          new Set(session.snapshots.keys()),
          {
            minX: session.bounds.minX + dx,
            minY: session.bounds.minY + dy,
            maxX: session.bounds.maxX + dx,
            maxY: session.bounds.maxY + dy,
          },
          s.viewport.zoom,
          s.gridSize,
          s.snapEnabled && !(e.ctrlKey || e.metaKey),
        );
        dx += snap.dx;
        dy += snap.dy;
        snapGuidesRef.current = snap.guides;
        const byId = new Map(s.elements.map((el) => [el.id, el]));
        for (const [id, snap] of session.snapshots) {
          const el = byId.get(id);
          if (!el || el.isDeleted || el.locked) continue;
          mutateElement(el, {
            x: snap.x + dx,
            y: snap.y + dy,
          } as Partial<LakarElement>);
          if (isContainerElement(el)) syncBoundText(s.elements, el);
        }
        updateBoundArrows(s.elements, new Set(session.snapshots.keys()));
        s.bumpScene();
        break;
      }
      case "resizing": {
        const unrotated = session.angle
          ? rotatePoint(p, session.center, -session.angle)
          : p;
        const { anchor, scaleX, scaleY } = computeResize(
          {
            handle: session.handle,
            originalBounds: session.originalBounds,
            angle: session.angle,
            snapshots: session.snapshots,
          },
          unrotated,
          e.shiftKey || session.isText,
          e.altKey,
        );
        if (Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) break;
        const byId = new Map(s.elements.map((el) => [el.id, el]));
        for (const snap of session.snapshots) {
          const el = byId.get(snap.id);
          if (!el || el.locked) continue;
          scaleElementFromSnapshot(el, snap, anchor, scaleX, scaleY);
          if (isTextElement(el) && !el.containerId) {
            refreshTextDimensions(el);
            const k = session.handle;
            if (k.includes("w")) mutateElement(el, { x: anchor.x - el.width });
            if (k.includes("n")) mutateElement(el, { y: anchor.y - el.height });
          }
          if (session.angle) fixCenterAfterRotatedResize(el, session.center);
          if (isContainerElement(el)) syncBoundText(s.elements, el);
        }
        updateBoundArrows(
          s.elements,
          new Set(session.snapshots.map((sn) => sn.id)),
        );
        s.bumpScene();
        break;
      }
      case "rotating": {
        const pointerAngle = Math.atan2(
          p.y - session.center.y,
          p.x - session.center.x,
        );
        let delta = pointerAngle - session.startPointerAngle;
        const byId = new Map(s.elements.map((el) => [el.id, el]));
        for (const [id, snap] of session.snapshots) {
          const el = byId.get(id);
          if (!el || el.locked) continue;
          let angle = snap.angle + delta;
          if (e.shiftKey) {
            angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
          }
          const newCenter = rotatePoint(
            { x: snap.cx, y: snap.cy },
            session.center,
            delta,
          );
          const b = getRotatedBoundsUnrotated(el);
          const w = b.maxX - b.minX;
          const h = b.maxY - b.minY;
          const curMin = { x: b.minX, y: b.minY };
          const targetMin = { x: newCenter.x - w / 2, y: newCenter.y - h / 2 };
          mutateElement(el, {
            angle,
            x: el.x + targetMin.x - curMin.x,
            y: el.y + targetMin.y - curMin.y,
          } as Partial<LakarElement>);
          if (isContainerElement(el)) syncBoundText(s.elements, el);
        }
        updateBoundArrows(s.elements, new Set(session.snapshots.keys()));
        s.bumpScene();
        break;
      }
      case "point-drag": {
        const el = session.el;
        const b = getRotatedBoundsUnrotated(el);
        const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        const local = el.angle ? rotatePoint(p, c, -el.angle) : p;
        let nx = local.x - el.x;
        let ny = local.y - el.y;
        if (e.shiftKey) {
          const ref =
            el.points[session.index === 0 ? 1 : session.index - 1] ?? [0, 0];
          const snapped = snapAngle(nx - ref[0], ny - ref[1]);
          nx = ref[0] + snapped.x;
          ny = ref[1] + snapped.y;
        }
        const points = el.points.map((pt) => [...pt] as [number, number]);
        points[session.index] = [nx, ny];
        mutateElement(el, { points } as Partial<LinearElement>);
        const isStart = session.index === 0;
        const isEnd = session.index === points.length - 1;
        if (isStart || isEnd) {
          applyBindingAt(
            el,
            isStart ? "start" : "end",
            { x: el.x + nx, y: el.y + ny },
            e.ctrlKey || e.metaKey,
          );
          reclipArrow(el);
        }
        s.bumpScene();
        break;
      }
      case "rubber": {
        session.current = p;
        const bounds: Bounds = {
          minX: Math.min(session.start.x, p.x),
          minY: Math.min(session.start.y, p.y),
          maxX: Math.max(session.start.x, p.x),
          maxY: Math.max(session.start.y, p.y),
        };
        const inBounds = getElementsInBounds(s.elements, bounds);
        const ids = expandToGroups(
          s.elements,
          inBounds.map((el) => el.id),
        );
        for (const id of session.prevSelection) ids.add(id);
        s.setSelectedIds(ids);
        scheduleRender();
        break;
      }
      case "erasing": {
        eraseAt(p, session.last);
        session.last = p;
        break;
      }
      case "laser": {
        laserMgrRef.current?.move(p);
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = useStore.getState();
    pointersRef.current.delete(e.pointerId);
    if (e.pointerType === "pen") penActiveRef.current = false;
    if (pinchRef.current) {
      const remaining = touchPoints().length;
      pinchRef.current = null;
      if (remaining >= 2) startPinch();
      return;
    }
    const session = sessionRef.current;
    if (!session) return;
    const p = clientToScene(e.clientX, e.clientY);

    switch (session.kind) {
      case "panning":
        setCursor(s.activeTool === "hand" || spaceRef.current ? "grab" : "default");
        break;
      case "drawing-shape": {
        const el = session.el;
        if (Math.abs(el.width) < 2 && Math.abs(el.height) < 2) {
          mutateElement(el, { isDeleted: true });
          s.bumpScene();
        } else {
          normalizeElement(el);
          s.bumpScene();
          history.commit();
          if (!s.toolLocked) {
            s.setTool("selection");
            s.setSelectedIds([el.id]);
          }
        }
        break;
      }
      case "drawing-linear": {
        const el = session.el;
        if (!session.moved) {
          multiPointRef.current = el;
          sessionRef.current = null;
          return;
        }
        normalizeLinear(el);
        s.bumpScene();
        history.commit();
        if (!s.toolLocked) {
          s.setTool("selection");
          s.setSelectedIds([el.id]);
        }
        break;
      }
      case "freedraw": {
        const el = session.el;
        if (el.points.length < 2) {
          mutateElement(el, {
            points: [...el.points, [0.001, 0.001]],
            pressures: [...el.pressures, el.pressures[0] ?? 0.5],
          } as Partial<FreedrawElement>);
        }
        normalizeLinear(el);
        s.bumpScene();
        history.commit();
        break;
      }
      case "moving": {
        if (session.moved) history.commit();
        updateHoverCursor(p);
        break;
      }
      case "resizing": {
        const byId = new Map(s.elements.map((el) => [el.id, el]));
        for (const snap of session.snapshots) {
          const el = byId.get(snap.id);
          if (el) normalizeElement(el);
        }
        s.bumpScene();
        history.commit();
        break;
      }
      case "rotating":
      case "point-drag": {
        if (session.kind === "point-drag") normalizeLinear(session.el);
        s.bumpScene();
        history.commit();
        updateHoverCursor(p);
        break;
      }
      case "rubber":
        scheduleRender();
        break;
      case "laser": {
        laserMgrRef.current?.end();
        break;
      }
      case "erasing": {
        const ids = expandWithBoundTexts(s.elements, s.pendingEraseIds);
        if (ids.size) {
          for (const el of s.elements) {
            if (ids.has(el.id)) mutateElement(el, { isDeleted: true });
          }
          unbindArrowsFromMissing(s.elements);
          s.setPendingErase([]);
          s.bumpScene();
          history.commit();
        }
        break;
      }
    }
    sessionRef.current = null;
    bindHighlightRef.current = null;
    snapGuidesRef.current = [];
    scheduleRender();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useStore.getState();
    if (s.presenting || s.viewerMode) return;
    if (multiPointRef.current) {
      finishMultiPoint(true);
      return;
    }
    if (s.activeTool !== "selection") return;
    const p = clientToScene(e.clientX, e.clientY);
    const hitEl = getElementAtPosition(s.elements, p, s.viewport.zoom);
    if (hitEl && isTextElement(hitEl)) {
      startTextEditing(p, hitEl);
      return;
    }
    if (hitEl && isFrameElement(hitEl)) {
      s.setSelectedIds([hitEl.id]);
      setRenamingFrameId(hitEl.id);
      return;
    }
    if (hitEl && isContainerElement(hitEl)) {
      startBoundTextEditing(hitEl, p);
      return;
    }
    const looseText =
      getTextAtPosition(s.elements, p, s.viewport.zoom) ??
      (hitEl ? getLooseTextInside(s.elements, hitEl, p) : undefined);
    if (looseText) {
      startTextEditing(p, looseText);
      return;
    }
    const container = getContainerAtPosition(s.elements, p);
    if (container) {
      startBoundTextEditing(container, p);
      return;
    }
    if (!hitEl) startTextEditing(p, null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useStore.getState();
    if (s.viewerMode) return;
    if (s.presenting) {
      prevSlide();
      return;
    }
    const p = clientToScene(e.clientX, e.clientY);
    const hitEl = getElementAtPosition(s.elements, p, s.viewport.zoom);
    if (hitEl && !s.selectedIds.has(hitEl.id)) {
      s.setSelectedIds(expandToGroups(s.elements, [hitEl.id]));
    }
    if (!hitEl) s.clearSelection();
    s.setContextMenu({ x: e.clientX, y: e.clientY, onCanvas: !hitEl });
  };

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <canvas ref={staticRef} className="canvas-layer" />
      <canvas ref={interactiveRef} className="canvas-layer" />
      <canvas ref={laserRef} className="canvas-layer laser-layer" />
      <CollabCursors />
      <LinkEditor />
      <TextEditorOverlay containerRef={containerRef} />
      {renamingFrameId && (
        <FrameNameEditor
          frameId={renamingFrameId}
          onClose={() => setRenamingFrameId(null)}
        />
      )}
    </div>
  );
};

const FrameNameEditor = ({
  frameId,
  onClose,
}: {
  frameId: string;
  onClose: () => void;
}) => {
  const viewport = useStore((s) => s.viewport);
  const el = useStore((s) => s.elements).find(
    (e) => e.id === frameId && !e.isDeleted,
  );
  const [name, setName] = useState(
    el && isFrameElement(el) ? el.name : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (!el || !isFrameElement(el)) return null;

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const s = useStore.getState();
    const trimmed = name.trim();
    if (trimmed && trimmed !== el.name) {
      mutateElement(el, { name: trimmed });
      s.bumpScene();
      history.commit();
    }
    onClose();
  };

  const minX = Math.min(el.x, el.x + el.width);
  const minY = Math.min(el.y, el.y + el.height);
  return (
    <input
      ref={inputRef}
      className="frame-name-input"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          committedRef.current = true;
          onClose();
        }
      }}
      style={{
        left: (minX - viewport.scrollX) * viewport.zoom,
        top: (minY - viewport.scrollY) * viewport.zoom - 24,
      }}
      aria-label="Frame name"
    />
  );
};

const snapAngle = (dx: number, dy: number): Point => {
  const len = Math.hypot(dx, dy);
  if (!len) return { x: 0, y: 0 };
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
  return { x: len * Math.cos(snapped), y: len * Math.sin(snapped) };
};
