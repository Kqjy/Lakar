import type { PeerPointer } from "../types";

const pointers = new Map<string, PeerPointer>();
const listeners = new Set<() => void>();
let snapshot: PeerPointer[] = [];
let notifyScheduled = 0;

const STALE_MS = 25_000;

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
    pointers.set(id, { ...existing, ...patch, updatedAt: Date.now() });
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
  pruneStale() {
    const cutoff = Date.now() - STALE_MS;
    let dropped = false;
    for (const [id, pointer] of pointers) {
      if (pointer.updatedAt < cutoff) {
        pointers.delete(id);
        dropped = true;
      }
    }
    if (dropped) notify();
  },
};
