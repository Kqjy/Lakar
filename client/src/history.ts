import { useStore } from "./store";
import type { LakarElement } from "./types";
import { newVersionNonce } from "./elements";

interface Snapshot {
  elements: LakarElement[];
  selectedIds: string[];
}

const MAX_HISTORY = 200;

class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastSerialized = "";
  private listeners = new Set<() => void>();

  private capture(): Snapshot {
    const s = useStore.getState();
    return {
      elements: JSON.parse(JSON.stringify(s.elements)),
      selectedIds: [...s.selectedIds],
    };
  }

  reset() {
    this.undoStack = [this.capture()];
    this.redoStack = [];
    this.lastSerialized = JSON.stringify(this.undoStack[0].elements);
    this.notify();
  }

  commit() {
    const snap = this.capture();
    const serialized = JSON.stringify(snap.elements);
    if (serialized === this.lastSerialized) return;
    this.undoStack.push(snap);
    this.lastSerialized = serialized;
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  get canUndo() {
    return this.undoStack.length > 1;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    this.apply(this.undoStack[this.undoStack.length - 1], current);
  }

  redo() {
    if (!this.canRedo) return;
    const snap = this.redoStack.pop()!;
    const previous = this.undoStack[this.undoStack.length - 1];
    this.undoStack.push(snap);
    this.apply(snap, previous);
  }

  private apply(snap: Snapshot, previous: Snapshot) {
    const s = useStore.getState();
    const targets = new Map(snap.elements.map((el) => [el.id, el]));
    const before = new Map(previous.elements.map((el) => [el.id, el]));
    const current = new Map(s.elements.map((el) => [el.id, el]));
    const ignored = new Set(["version", "versionNonce", "deletedAt"]);
    for (const id of new Set([...targets.keys(), ...before.keys()])) {
      const target = targets.get(id);
      const old = before.get(id);
      const live = current.get(id);
      let next = { ...(live ?? target ?? old)! } as LakarElement;
      let changed = false;
      if (!target || !old) {
        next = { ...(target ?? next), isDeleted: target?.isDeleted ?? true };
        changed = true;
      } else {
        for (const key of new Set([...Object.keys(old), ...Object.keys(target)])) {
          if (ignored.has(key)) continue;
          const field = key as keyof LakarElement;
          if (JSON.stringify(old[field]) === JSON.stringify(target[field])) continue;
          if (live && JSON.stringify(live[field]) !== JSON.stringify(old[field])) continue;
          Object.assign(next, { [key]: target[field] });
          changed = true;
        }
      }
      if (!changed) continue;
      next = JSON.parse(JSON.stringify(next));
      next.version = Math.max(live?.version ?? 0, target?.version ?? 0, old?.version ?? 0) + 1;
      next.versionNonce = newVersionNonce();
      next.deletedAt = next.isDeleted ? Date.now() : undefined;
      current.set(id, next);
    }
    const orderChanged = previous.elements.map((el) => el.id).join() !== snap.elements.map((el) => el.id).join();
    const order = orderChanged ? snap.elements : s.elements;
    const restored = order.map((el) => current.get(el.id)!).filter(Boolean);
    const included = new Set(restored.map((el) => el.id));
    for (const el of current.values()) if (!included.has(el.id)) restored.push(el);
    this.lastSerialized = JSON.stringify(restored);
    s.replaceElements(restored);
    const existing = new Set(restored.filter((e) => !e.isDeleted).map((e) => e.id));
    s.setSelectedIds(snap.selectedIds.filter((id) => existing.has(id)));
    s.setEditingText(null);
    this.notify();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private notify() {
    for (const fn of this.listeners) fn();
  }
}

export const history = new History();
