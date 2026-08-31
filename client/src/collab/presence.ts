import type { PeerPointer } from "../types";

const pointers = new Map<string, PeerPointer>();
const listeners = new Set<() => void>();
let snapshot: PeerPointer[] = [];
let notifyScheduled = 0;

export const IDLE_MS = 25_000;

const rebuild = () => {
  snapshot = [...pointers.values()];
};

const notify = () => {
  if (notifyScheduled) return;
  notifyScheduled = requestAnimationFrame(() => {
    notifyScheduled = 0;
    rebuild();
    for (const fn of listeners) fn();
  });
};

export const presence = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getPointers(): PeerPointer[] {
    return snapshot;
  },
  set(pointer: PeerPointer) {
    pointers.set(pointer.id, pointer);
    notify();
  },
  patch(id: string, patch: Partial<PeerPointer>) {
    const existing = pointers.get(id);
    if (!existing) return;
    pointers.set(id, { ...existing, ...patch });
    notify();
  },
  remove(id: string) {
    if (pointers.delete(id)) notify();
  },
  clear() {
    if (!pointers.size) return;
    pointers.clear();
    notify();
  },
  prune(liveIds: ReadonlySet<string>) {
    let dropped = false;
    for (const id of pointers.keys()) {
      if (liveIds.has(id)) continue;
      pointers.delete(id);
      dropped = true;
    }
    if (dropped) notify();
  },
};
