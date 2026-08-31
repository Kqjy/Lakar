import { useStore } from "./store";
import type { LakarElement } from "./types";

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
    this.apply(this.undoStack[this.undoStack.length - 1]);
  }

  redo() {
    if (!this.canRedo) return;
    const snap = this.redoStack.pop()!;
    this.undoStack.push(snap);
    this.apply(snap);
  }

  private apply(snap: Snapshot) {
    const s = useStore.getState();
    const restored = JSON.parse(JSON.stringify(snap.elements)) as LakarElement[];
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
