import { nanoid } from "nanoid";
import { getSelectedElements, getVisibleElements, useStore } from "../store";
import type { Point, LakarElement } from "../types";
import {
  isBoundText,
  isContainerElement,
  isLinearLike,
  isTextElement,
} from "../types";
import {
  expandWithBoundTexts,
  getContainerOf,
  syncBoundText,
} from "../boundText";
import { expandWithFrameMembers } from "../frames";
import {
  releaseBindingsNotMoving,
  remapBindings,
  unbindArrowsFromMissing,
  updateBoundArrows,
} from "../binding";
import {
  duplicateElement,
  getCommonBounds,
  mutateElement,
  newElementId,
  newVersionNonce,
  refreshTextDimensions,
} from "../elements";
import { randomSeed } from "../math";
import { history } from "../history";
import { TEXT_LINE_HEIGHT } from "../constants";

export const expandToGroups = (
  elements: readonly LakarElement[],
  ids: Iterable<string>,
): Set<string> => {
  const idSet = new Set(ids);
  const groupIds = new Set<string>();
  for (const el of elements) {
    if (idSet.has(el.id) && el.groupIds.length > 0) {
      groupIds.add(el.groupIds[el.groupIds.length - 1]);
    }
  }
  if (groupIds.size) {
    for (const el of elements) {
      if (el.groupIds.some((g) => groupIds.has(g))) idSet.add(el.id);
    }
  }
  return idSet;
};

export const deleteSelected = () => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (!selected.length) return;
  const ids = expandWithBoundTexts(
    s.elements,
    selected.map((el) => el.id),
  );
  for (const el of s.elements) {
    if (ids.has(el.id)) mutateElement(el, { isDeleted: true });
  }
  unbindArrowsFromMissing(s.elements);
  s.clearSelection();
  s.bumpScene();
  history.commit();
};

export const duplicateSelected = (offset = 12): LakarElement[] => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (!selected.length) return [];

  const ids = expandWithBoundTexts(
    s.elements,
    selected.map((el) => el.id),
  );
  const sources = s.elements.filter((el) => ids.has(el.id));
  const groupMap = new Map<string, string>();
  const idMap = new Map<string, string>();
  const copies = sources.map((el) => {
    const copy = duplicateElement(el, offset);
    idMap.set(el.id, copy.id);
    copy.groupIds = el.groupIds.map((g) => {
      if (!groupMap.has(g)) groupMap.set(g, nanoid(10));
      return groupMap.get(g)!;
    });
    return copy;
  });
  for (const copy of copies) {
    if (isTextElement(copy) && copy.containerId) {
      copy.containerId = idMap.get(copy.containerId) ?? null;
    }
    remapBindings(copy, idMap);
  }
  s.replaceElements([...s.elements, ...copies]);
  s.setSelectedIds(
    copies.filter((c) => !isBoundText(c)).map((c) => c.id),
  );
  history.commit();
  return copies;
};

export const selectAll = () => {
  const s = useStore.getState();
  s.setSelectedIds(getVisibleElements().filter((el) => !el.locked).map((el) => el.id));
  if (s.activeTool !== "selection") s.setTool("selection");
};

export const nudgeSelected = (dx: number, dy: number) => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (!selected.length) return;
  const ids = expandWithFrameMembers(
    s.elements,
    selected.map((el) => el.id),
  );
  releaseBindingsNotMoving(s.elements, ids);
  for (const el of s.elements) {
    if (el.isDeleted || el.locked || !ids.has(el.id)) continue;
    mutateElement(el, { x: el.x + dx, y: el.y + dy } as Partial<LakarElement>);
    if (isContainerElement(el)) syncBoundText(s.elements, el);
  }
  updateBoundArrows(s.elements, ids);
  s.bumpScene();
};

export type AlignMode =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "center-v"
  | "bottom";

const selectionUnits = (
  selected: readonly LakarElement[],
): LakarElement[][] => {
  const byGroup = new Map<string, LakarElement[]>();
  const singles: LakarElement[][] = [];
  for (const el of selected) {
    const g = el.groupIds[el.groupIds.length - 1];
    if (g) {
      const list = byGroup.get(g);
      if (list) list.push(el);
      else byGroup.set(g, [el]);
    } else {
      singles.push([el]);
    }
  }
  return [...singles, ...byGroup.values()];
};

const shiftUnit = (
  elements: readonly LakarElement[],
  unit: readonly LakarElement[],
  dx: number,
  dy: number,
) => {
  if (!dx && !dy) return;
  const ids = expandWithFrameMembers(
    elements,
    expandWithBoundTexts(elements, unit.map((el) => el.id)),
  );
  for (const el of elements) {
    if (el.isDeleted || el.locked || !ids.has(el.id)) continue;
    mutateElement(el, { x: el.x + dx, y: el.y + dy } as Partial<LakarElement>);
    if (isContainerElement(el)) syncBoundText(elements, el);
  }
};

const alignableSelection = () =>
  getSelectedElements().filter((el) => !el.locked && !isBoundText(el));

export const alignSelected = (mode: AlignMode) => {
  const s = useStore.getState();
  const selected = alignableSelection();
  const units = selectionUnits(selected);
  if (units.length < 2) return;

  const overall = getCommonBounds(selected);
  const moved = new Set<string>();
  for (const unit of units) {
    const b = getCommonBounds(unit);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = overall.minX - b.minX;
    else if (mode === "right") dx = overall.maxX - b.maxX;
    else if (mode === "center-h") {
      dx = (overall.minX + overall.maxX) / 2 - (b.minX + b.maxX) / 2;
    } else if (mode === "top") dy = overall.minY - b.minY;
    else if (mode === "bottom") dy = overall.maxY - b.maxY;
    else dy = (overall.minY + overall.maxY) / 2 - (b.minY + b.maxY) / 2;
    shiftUnit(s.elements, unit, dx, dy);
    for (const el of unit) moved.add(el.id);
  }
  updateBoundArrows(s.elements, moved);
  s.bumpScene();
  history.commit();
};

export const distributeSelected = (axis: "h" | "v") => {
  const s = useStore.getState();
  const units = selectionUnits(alignableSelection());
  if (units.length < 3) return;

  const horizontal = axis === "h";
  const entries = units
    .map((unit) => ({ unit, b: getCommonBounds(unit) }))
    .sort((a, z) => (horizontal ? a.b.minX - z.b.minX : a.b.minY - z.b.minY));

  const first = entries[0].b;
  const last = entries[entries.length - 1].b;
  const span = horizontal
    ? last.maxX - first.minX
    : last.maxY - first.minY;
  const total = entries.reduce(
    (acc, { b }) => acc + (horizontal ? b.maxX - b.minX : b.maxY - b.minY),
    0,
  );
  const gap = (span - total) / (entries.length - 1);

  let cursor = horizontal ? first.minX : first.minY;
  const moved = new Set<string>();
  for (const { unit, b } of entries) {
    const size = horizontal ? b.maxX - b.minX : b.maxY - b.minY;
    const delta = cursor - (horizontal ? b.minX : b.minY);
    shiftUnit(s.elements, unit, horizontal ? delta : 0, horizontal ? 0 : delta);
    for (const el of unit) moved.add(el.id);
    cursor += size + gap;
  }
  updateBoundArrows(s.elements, moved);
  s.bumpScene();
  history.commit();
};

export type ZOrderOp = "toFront" | "toBack" | "forward" | "backward";

export const reorderSelected = (op: ZOrderOp) => {
  const s = useStore.getState();
  const els = [...s.elements];
  const sel = s.selectedIds;
  if (!sel.size) return;
  const selected = els.filter((e) => sel.has(e.id));
  const rest = els.filter((e) => !sel.has(e.id));
  let next: LakarElement[];
  if (op === "toFront") next = [...rest, ...selected];
  else if (op === "toBack") next = [...selected, ...rest];
  else {
    next = els;
    const indices = els
      .map((e, i) => (sel.has(e.id) ? i : -1))
      .filter((i) => i >= 0);
    if (op === "forward") {
      for (let k = indices.length - 1; k >= 0; k--) {
        const i = indices[k];
        if (i < els.length - 1 && !sel.has(els[i + 1].id)) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
    } else {
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        if (i > 0 && !sel.has(els[i - 1].id)) {
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
        }
      }
    }
  }
  s.replaceElements(next);
  history.commit();
};

export const groupSelected = () => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (selected.length < 2) return;
  const gid = nanoid(10);
  for (const el of selected) {
    mutateElement(el, { groupIds: [...el.groupIds, gid] });
  }
  s.bumpScene();
  history.commit();
};

export const ungroupSelected = () => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  let changed = false;
  for (const el of selected) {
    if (el.groupIds.length) {
      mutateElement(el, { groupIds: el.groupIds.slice(0, -1) });
      changed = true;
    }
  }
  if (changed) {
    s.bumpScene();
    history.commit();
  }
};

export const toggleLockSelected = () => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (!selected.length) return;
  const anyUnlocked = selected.some((el) => !el.locked);
  for (const el of selected) mutateElement(el, { locked: anyUnlocked });
  if (anyUnlocked) s.clearSelection();
  s.bumpScene();
  history.commit();
};

const CLIPBOARD_TYPE = "lakar/elements";

interface ClipboardPayload {
  type: typeof CLIPBOARD_TYPE;
  elements: LakarElement[];
}

export const copySelected = async (): Promise<boolean> => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (!selected.length) return false;
  const ids = expandWithBoundTexts(
    s.elements,
    selected.map((el) => el.id),
  );
  const payload: ClipboardPayload = {
    type: CLIPBOARD_TYPE,
    elements: JSON.parse(
      JSON.stringify(s.elements.filter((el) => ids.has(el.id))),
    ),
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
};

export const cutSelected = async () => {
  if (await copySelected()) deleteSelected();
};

export const pasteText = (text: string, scenePoint: Point | null) => {
  try {
    const parsed = JSON.parse(text) as ClipboardPayload;
    if (parsed.type === CLIPBOARD_TYPE && Array.isArray(parsed.elements)) {
      pasteElements(parsed.elements, scenePoint);
      return;
    }
  } catch {
    
  }
  pastePlainText(text, scenePoint);
};

export const pasteFromClipboard = async (scenePoint: Point | null) => {
  const s = useStore.getState();
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    s.toast("Clipboard unavailable — allow clipboard access to paste", "error");
    return;
  }
  if (!text) return;
  pasteText(text, scenePoint);
};

export const pasteElements = (
  incoming: LakarElement[],
  scenePoint: Point | null,
) => {
  const s = useStore.getState();
  const bounds = getCommonBounds(incoming);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const target = scenePoint ?? viewportCenter();
  const dx = target.x - cx;
  const dy = target.y - cy;
  const groupMap = new Map<string, string>();
  const idMap = new Map<string, string>();
  const copies = incoming.map((el) => {
    const copy = JSON.parse(JSON.stringify(el)) as LakarElement;
    copy.id = newElementId();
    idMap.set(el.id, copy.id);
    copy.seed = randomSeed();
    copy.version = 1;
    copy.versionNonce = newVersionNonce();
    copy.x += dx;
    copy.y += dy;
    copy.isDeleted = false;
    copy.groupIds = copy.groupIds.map((g) => {
      if (!groupMap.has(g)) groupMap.set(g, nanoid(10));
      return groupMap.get(g)!;
    });
    return copy;
  });
  for (const copy of copies) {
    if (isTextElement(copy) && copy.containerId) {
      copy.containerId = idMap.get(copy.containerId) ?? null;
    }
    remapBindings(copy, idMap);
  }
  s.replaceElements([...s.elements, ...copies]);
  s.setSelectedIds(copies.filter((c) => !isBoundText(c)).map((c) => c.id));
  if (s.activeTool !== "selection") s.setTool("selection");
  history.commit();
};

const pastePlainText = (text: string, scenePoint: Point | null) => {
  const s = useStore.getState();
  const target = scenePoint ?? viewportCenter();
  const el: LakarElement = {
    id: newElementId(),
    type: "text",
    x: target.x,
    y: target.y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: s.itemDefaults.strokeColor,
    backgroundColor: "transparent",
    fillStyle: s.itemDefaults.fillStyle,
    strokeWidth: s.itemDefaults.strokeWidth,
    strokeStyle: s.itemDefaults.strokeStyle,
    roughness: s.itemDefaults.roughness,
    opacity: s.itemDefaults.opacity,
    roundEdges: false,
    seed: randomSeed(),
    version: 1,
    versionNonce: newVersionNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    text: text.slice(0, 5000),
    fontSize: s.itemDefaults.fontSize,
    fontFamily: s.itemDefaults.fontFamily,
    textAlign: "left",
    lineHeight: TEXT_LINE_HEIGHT,
    containerId: null,
  };
  refreshTextDimensions(el);

  mutateElement(el, { x: el.x - el.width / 2, y: el.y - el.height / 2 });
  s.replaceElements([...s.elements, el]);
  s.setSelectedIds([el.id]);
  history.commit();
};

export const viewportCenter = (): Point => {
  const { viewport } = useStore.getState();
  return {
    x: viewport.scrollX + window.innerWidth / 2 / viewport.zoom,
    y: viewport.scrollY + window.innerHeight / 2 / viewport.zoom,
  };
};

export const applyStyleToSelection = (
  updates: Partial<LakarElement> & { fontSize?: number; fontFamily?: string; textAlign?: string; startArrowhead?: string; endArrowhead?: string },
) => {
  const s = useStore.getState();
  const selected = getSelectedElements();
  if (!selected.length) return false;
  for (const el of selected) {
    const applicable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key in el) applicable[key] = value;
    }
    if (Object.keys(applicable).length) {
      mutateElement(el, applicable as Partial<LakarElement>);
      if (
        isTextElement(el) &&
        ("fontSize" in applicable ||
          "fontFamily" in applicable ||
          "text" in applicable ||
          "textAlign" in applicable)
      ) {
        refreshTextDimensions(el, true);
        const container = getContainerOf(s.elements, el);
        if (container) syncBoundText(s.elements, container);
      }
    }
  }
  s.bumpScene();
  return true;
};
