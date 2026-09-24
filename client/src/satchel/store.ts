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
import { api, ApiError } from "../sync/api";
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

interface SatchelCache {
  items: StoredItem[];
  owner: string | null;
  writes: [string, "create" | "update"][];
  deletes: string[];
}

class Satchel {
  private syncing = false;
  private generation = 0;
  private writes = new Map<string, "create" | "update">();
  private deletes = new Set<string>();
  private retryTimer: number | null = null;
  private owner: string | null = null;

  async init() {
    const generation = ++this.generation;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const owner = useStore.getState().user?.email ?? null;
    const stored = await loadSatchelItems<StoredItem[] | SatchelCache>();
    if (generation !== this.generation) return;
    const legacy = Array.isArray(stored);
    const sameOwner = legacy || !stored?.owner || stored.owner === owner;
    const items = sameOwner ? (legacy ? stored : stored?.items ?? []) : [];
    this.owner = owner;
    this.writes = new Map(sameOwner && !legacy ? stored?.writes ?? [] : []);
    this.deletes = new Set(sameOwner && !legacy ? stored?.deletes ?? [] : []);
    if (legacy && !owner) for (const item of items) this.writes.set(item.id, "create");
    useStore.getState().setSatchelItems(items.filter(isStoredItem).map(fromStored));
    if (syncManager.isSignedIn()) void this.pullRemote();
  }

  private scheduleRetry() {
    if (this.retryTimer || !syncManager.isSignedIn()) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.pullRemote();
    }, 15_000);
  }

  async pullRemote() {
    if (this.syncing || !syncManager.isSignedIn()) return;
    this.syncing = true;
    const generation = this.generation;
    const valid = () => generation === this.generation && this.owner === (useStore.getState().user?.email ?? null);
    try {
      for (const id of this.deletes) {
        await api.deleteSatchelItem(id);
        if (!valid()) return;
        this.deletes.delete(id);
        await this.persistLocal(useStore.getState().satchelItems);
      }
      for (const [id, kind] of this.writes) {
        const item = useStore.getState().satchelItems.find((it) => it.id === id);
        if (!item) { this.writes.delete(id); continue; }
        const encData = await syncManager.encryptForUser(id, toStored(item));
        if (!encData || !valid()) return;
        try {
          if (kind === "create") await api.createSatchelItem(id, encData);
          else await api.updateSatchelItem(id, encData);
        } catch (err) {
          if (kind === "create" && err instanceof ApiError && err.status === 409) {
            await api.updateSatchelItem(id, encData);
          } else if (!(kind === "update" && err instanceof ApiError && err.status === 404)) throw err;
        }
        if (!valid()) return;
        if (useStore.getState().satchelItems.find((it) => it.id === id) === item) this.writes.delete(id);
        await this.persistLocal(useStore.getState().satchelItems);
      }
      const { items } = await api.listSatchel();
      const remote: SatchelItem[] = [];
      for (const row of items) {
        const decoded = await syncManager.decryptForUser<StoredItem>(row.id, row.encData);
        if (!valid()) return;
        if (decoded && isStoredItem(decoded) && !this.deletes.has(row.id)) {
          remote.push({ ...fromStored(decoded), id: row.id, createdAt: row.createdAt });
        }
      }
      if (!valid()) return;
      const merged = new Map(remote.map((item) => [item.id, item]));
      for (const item of useStore.getState().satchelItems) {
        if (this.writes.has(item.id) && !this.deletes.has(item.id)) merged.set(item.id, item);
      }
      const next = [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
      useStore.getState().setSatchelItems(next);
      await this.persistLocal(next);
    } catch {
      if (valid()) this.scheduleRetry();
    } finally {
      this.syncing = false;
      if (!valid() || this.writes.size || this.deletes.size) this.scheduleRetry();
    }
  }

  private async persistLocal(items: SatchelItem[]) {
    await saveSatchelItems({ items: items.map(toStored), owner: this.owner, writes: [...this.writes], deletes: [...this.deletes] } satisfies SatchelCache);
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
    this.writes.set(item.id, "create");
    await this.persistLocal(next);
    void this.pullRemote();
    return item;
  }

  async rename(id: string, name: string) {
    const s = useStore.getState();
    const target = s.satchelItems.find((item) => item.id === id);
    if (!target) return;
    const renamed = { ...target, name: name.trim() || target.name };
    const next = s.satchelItems.map((item) => (item.id === id ? renamed : item));
    s.setSatchelItems(next);
    this.writes.set(id, this.writes.get(id) ?? "update");
    await this.persistLocal(next);
    void this.pullRemote();
  }

  async remove(id: string) {
    const s = useStore.getState();
    const next = s.satchelItems.filter((item) => item.id !== id);
    s.setSatchelItems(next);
    this.writes.delete(id);
    this.deletes.add(id);
    await this.persistLocal(next);
    void this.pullRemote();
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
    for (const item of incoming) this.writes.set(item.id, "create");
    await this.persistLocal(next);
    void this.pullRemote();
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
