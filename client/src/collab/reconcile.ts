import type { LakarElement } from "../types";

export const remoteWins = (
  local: LakarElement,
  remote: LakarElement,
): boolean => {
  if (remote.version !== local.version) return remote.version > local.version;
  if (remote.versionNonce !== local.versionNonce) {
    return remote.versionNonce < local.versionNonce;
  }
  return false;
};

export interface MergeResult {
  elements: LakarElement[];
  changed: Set<string>;
}

export const mergeIncoming = (
  local: readonly LakarElement[],
  incoming: readonly LakarElement[],
): MergeResult => {
  const changed = new Set<string>();
  const byId = new Map(local.map((el) => [el.id, el]));
  const appended: LakarElement[] = [];

  for (const remote of incoming) {
    const existing = byId.get(remote.id);
    if (!existing) {
      byId.set(remote.id, remote);
      appended.push(remote);
      changed.add(remote.id);
      continue;
    }
    if (remoteWins(existing, remote)) {
      byId.set(remote.id, remote);
      changed.add(remote.id);
    }
  }

  if (!changed.size) return { elements: local as LakarElement[], changed };

  const elements = local.map((el) => byId.get(el.id) ?? el);
  elements.push(...appended);
  return { elements, changed };
};

export const mergeFullScene = (
  local: readonly LakarElement[],
  remote: readonly LakarElement[],
): MergeResult => {
  const changed = new Set<string>();
  const localById = new Map(local.map((el) => [el.id, el]));
  const remoteIds = new Set(remote.map((el) => el.id));

  const precedingLocalOnly = new Map<string, LakarElement[]>();
  let bucket: LakarElement[] = [];
  for (const el of local) {
    if (remoteIds.has(el.id)) {
      if (bucket.length) {
        precedingLocalOnly.set(el.id, bucket);
        bucket = [];
      }
    } else {
      bucket.push(el);
    }
  }
  const trailingLocalOnly = bucket;

  const elements: LakarElement[] = [];
  for (const incoming of remote) {
    const before = precedingLocalOnly.get(incoming.id);
    if (before) elements.push(...before);
    const existing = localById.get(incoming.id);
    if (!existing || remoteWins(existing, incoming)) {
      elements.push(incoming);
      changed.add(incoming.id);
    } else {
      elements.push(existing);
    }
  }
  elements.push(...trailingLocalOnly);
  return { elements, changed };
};

export const diffSince = (
  elements: readonly LakarElement[],
  sent: Map<string, number>,
): LakarElement[] => {
  const out: LakarElement[] = [];
  for (const el of elements) {
    if (sent.get(el.id) !== el.version) out.push(el);
  }
  return out;
};
