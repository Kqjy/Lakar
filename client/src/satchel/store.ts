import { nanoid } from "nanoid";
import { useStore, getSelectedElements } from "../store";
import type { LakarElement, Point, SatchelItem } from "../types";
import { isBoundText, isTextElement } from "../types";
import {
  getCommonBounds,
  newElementId,
  newVersionNonce,
} from "../elements";
import { randomSeed } from "../math";
import { expandWithBoundTexts } from "../boundText";
import { history } from "../history";
import { viewportCenter } from "../interaction/actions";
import { api } from "../sync/api";
import { syncManager } from "../sync/manager";
import { loadSatchelItems, saveSatchelItems } from "../sync/local";
import { downloadBlob } from "../export/image";
import { BUILT_IN_SHAPES } from "./catalog";

const MAX_ITEM_ELEMENTS = 400;

let builtInCache: SatchelItem[] | null = null;

export const getBuiltInItems = (): SatchelItem[] => {
  if (!builtInCache) {
    builtInCache = BUILT_IN_SHAPES.map((def) => ({
      id: def.id,
      name: def.name,
      category: def.category,
      keywords: def.keywords,
      elements: def.build(),
      mine: false,
      createdAt: 0,
    }));
  }
  return builtInCache;
};

interface StoredItem {
  id: string;
  name: string;
  keywords: string[];
  elements: LakarElement[];
  createdAt: number;
}

const toStored = (item: SatchelItem): StoredItem => ({
  id: item.id,
  name: item.name,
  keywords: item.keywords,
  elements: item.elements,
  createdAt: item.createdAt,
});

const fromStored = (stored: StoredItem): SatchelItem => ({
  id: stored.id,
  name: stored.name || "Untitled shape",
  category: "mine",
  keywords: Array.isArray(stored.keywords) ? stored.keywords : [],
  elements: Array.isArray(stored.elements) ? stored.elements : [],
  mine: true,
  createdAt: stored.createdAt || Date.now(),
});

const isStoredItem = (value: unknown): value is StoredItem => {
  const item = value as StoredItem;
  return (
    !!item &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    Array.isArray(item.elements) &&
    item.elements.length > 0
  );
};

class Satchel {
  private syncing = false;

  async init() {
    const stored = (await loadSatchelItems<StoredItem[]>()) ?? [];
    const local = stored.filter(isStoredItem).map(fromStored);
    useStore.getState().setSatchelItems(local);
    if (syncManager.isSignedIn()) void this.pullRemote();
  }

  async pullRemote() {
    if (this.syncing || !syncManager.isSignedIn()) return;
    this.syncing = true;
    try {
      const { items } = await api.listSatchel();
      const remote: SatchelItem[] = [];
      for (const row of items) {
        const decoded = await syncManager.decryptForUser<StoredItem>(row.id, row.encData);
        if (decoded && isStoredItem(decoded)) {
          remote.push({ ...fromStored(decoded), id: row.id, createdAt: row.createdAt });
        }
      }
      const local = useStore.getState().satchelItems;
      const remoteIds = new Set(remote.map((item) => item.id));
      const merged = [...remote];
      for (const item of local) {
        if (!remoteIds.has(item.id)) {
          merged.push(item);
          void this.pushOne(item);
        }
      }
      merged.sort((a, b) => a.createdAt - b.createdAt);
      useStore.getState().setSatchelItems(merged);
      await this.persistLocal(merged);
    } catch {
      void 0;
    } finally {
      this.syncing = false;
    }
  }

  private async persistLocal(items: SatchelItem[]) {
    await saveSatchelItems(items.map(toStored));
  }

  private async pushOne(item: SatchelItem) {
    if (!syncManager.isSignedIn()) return;
    try {
      const encData = await syncManager.encryptForUser(item.id, toStored(item));
      if (encData) await api.createSatchelItem(item.id, encData);
    } catch {
      void 0;
    }
  }

  canAddSelection() {
    return getSelectedElements().length > 0;
  }

  private visibleCenter(): Point {
    const s = useStore.getState();
    const center = viewportCenter();
    if (!s.satchelOpen) return center;
    const panel = Math.min(374, window.innerWidth * 0.94);
    return { x: center.x - panel / 2 / s.viewport.zoom, y: center.y };
  }

  async addFromSelection(name: string): Promise<SatchelItem | null> {
    const s = useStore.getState();
    const selected = getSelectedElements();
    if (!selected.length) return null;
    const ids = expandWithBoundTexts(
      s.elements,
      selected.map((el) => el.id),
    );
    const sources = s.elements.filter((el) => ids.has(el.id) && !el.isDeleted);
    if (!sources.length || sources.length > MAX_ITEM_ELEMENTS) return null;

    const bounds = getCommonBounds(sources);
    const clones = JSON.parse(JSON.stringify(sources)) as LakarElement[];
    for (const el of clones) {
      el.x -= bounds.minX;
      el.y -= bounds.minY;
      el.groupIds = [];
      el.frameId = null;
      el.locked = false;
    }
    const item: SatchelItem = {
      id: nanoid(14),
      name: name.trim() || "My shape",
      category: "mine",
      keywords: [],
      elements: clones,
      mine: true,
      createdAt: Date.now(),
    };
    const next = [...s.satchelItems, item];
    s.setSatchelItems(next);
    await this.persistLocal(next);
    void this.pushOne(item);
    return item;
  }

  async rename(id: string, name: string) {
    const s = useStore.getState();
    const target = s.satchelItems.find((item) => item.id === id);
    if (!target) return;
    const renamed = { ...target, name: name.trim() || target.name };
    const next = s.satchelItems.map((item) => (item.id === id ? renamed : item));
    s.setSatchelItems(next);
    await this.persistLocal(next);
    if (syncManager.isSignedIn()) {
      try {
        await api.deleteSatchelItem(id);
      } catch {
        void 0;
      }
      void this.pushOne(renamed);
    }
  }

  async remove(id: string) {
    const s = useStore.getState();
    const next = s.satchelItems.filter((item) => item.id !== id);
    s.setSatchelItems(next);
    await this.persistLocal(next);
    if (syncManager.isSignedIn()) {
      try {
        await api.deleteSatchelItem(id);
      } catch {
        void 0;
      }
    }
  }

  place(item: SatchelItem, target: Point | null): LakarElement[] {
    const s = useStore.getState();
    const point = target ?? this.visibleCenter();
    const bounds = getCommonBounds(item.elements);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const groupId = item.elements.length > 1 ? nanoid(10) : null;
    const idMap = new Map<string, string>();

    const clones = (JSON.parse(JSON.stringify(item.elements)) as LakarElement[]).map(
      (el) => {
        const id = newElementId();
        idMap.set(el.id, id);
        el.id = id;
        el.seed = randomSeed();
        el.version = 1;
        el.versionNonce = newVersionNonce();
        el.isDeleted = false;
        el.x += dx;
        el.y += dy;
        el.groupIds =
          groupId && !(isTextElement(el) && el.containerId) ? [groupId] : [];
        el.frameId = null;
        return el;
      },
    );
    for (const el of clones) {
      if (isTextElement(el) && el.containerId) {
        el.containerId = idMap.get(el.containerId) ?? null;
      }
    }
    s.replaceElements([...s.elements, ...clones]);
    s.setSelectedIds(clones.filter((el) => !isBoundText(el)).map((el) => el.id));
    if (s.activeTool !== "selection") s.setTool("selection");
    history.commit();
    return clones;
  }

  exportAll() {
    const items = useStore.getState().satchelItems;
    const doc = {
      type: "lakar-satchel",
      version: 1,
      items: items.map(toStored),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, "my-shapes.lakarsatchel");
  }

  async importFromFile(): Promise<number> {
    const file = await pickFile();
    if (!file) return 0;
    let parsed: { type?: string; items?: unknown[] };
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return 0;
    }
    if (parsed?.type !== "lakar-satchel" || !Array.isArray(parsed.items)) {
      return 0;
    }
    const s = useStore.getState();
    const existing = new Set(s.satchelItems.map((item) => item.id));
    const incoming: SatchelItem[] = [];
    for (const raw of parsed.items) {
      if (!isStoredItem(raw)) continue;
      const item = fromStored(raw);
      if (existing.has(item.id)) item.id = nanoid(14);
      item.createdAt = Date.now() + incoming.length;
      incoming.push(item);
    }
    if (!incoming.length) return 0;
    const next = [...s.satchelItems, ...incoming];
    s.setSatchelItems(next);
    await this.persistLocal(next);
    for (const item of incoming) void this.pushOne(item);
    return incoming.length;
  }
}

const pickFile = (): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".lakarsatchel,.json,application/json";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });

export const satchel = new Satchel();
