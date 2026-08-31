import { del, get, keys, set } from "idb-keyval";
import type { SceneDocument } from "../export/json";

const ENC_KEY_SLOT = "lakar:enc-key";
const KEYS_SLOT = "lakar:keys";
const ARK_SLOT = "lakar:ark";
const RING_SLOT = "lakar:ring";
const USER_ID_SLOT = "lakar:user-id";
const GUEST_DOC = "lakar:guest-doc";
const SCENE_PREFIX = "lakar:scene:";
const ROOM_PREFIX = "lakar:room:";
const META_SLOT = "lakar:remote-cache";
const SATCHEL_SLOT = "lakar:satchel";

export interface CachedRemoteState {
  scenes: {
    id: string;
    title: string;
    folderId: string | null;
    version: number;
    createdAt: number;
    updatedAt: number;
    dirty: boolean;
  }[];
  folders: { id: string; name: string; createdAt: number }[];
  lastOpenSceneId: string | null;
}

export const loadLegacyEncKey = async (): Promise<CryptoKey | null> =>
  (await get<CryptoKey>(ENC_KEY_SLOT)) ?? null;

export interface StoredRing {
  writeEpoch: number;
  entries: [number, CryptoKey][];
}

export interface KeyMaterial {
  userId: string;
  ark: CryptoKey;
  ring: StoredRing;
}

export const storeKeyMaterial = async (
  userId: string,
  ark: CryptoKey,
  ring: StoredRing,
) => {
  if (ark.extractable) {
    throw new Error("Refusing to persist an extractable account root key");
  }
  if (ring.entries.some(([, k]) => k.extractable)) {
    throw new Error("Refusing to persist an extractable data key");
  }
  await set(KEYS_SLOT, { userId, ark, ring } satisfies KeyMaterial);
  await Promise.all([del(ENC_KEY_SLOT), del(ARK_SLOT), del(RING_SLOT), del(USER_ID_SLOT)]);
};

export const loadKeyMaterial = async (): Promise<KeyMaterial | null> => {
  const stored = await get<KeyMaterial>(KEYS_SLOT);
  if (!stored?.userId || !stored.ark || !stored.ring?.entries?.length) return null;
  return stored;
};

export const clearEncKey = async () => {
  await Promise.all([
    del(ENC_KEY_SLOT),
    del(KEYS_SLOT),
    del(ARK_SLOT),
    del(RING_SLOT),
    del(USER_ID_SLOT),
  ]);
};

export const saveGuestDoc = (doc: SceneDocument) => set(GUEST_DOC, doc);
export const loadGuestDoc = async (): Promise<SceneDocument | null> =>
  (await get<SceneDocument>(GUEST_DOC)) ?? null;

export const saveSceneDoc = (id: string, doc: SceneDocument) =>
  set(SCENE_PREFIX + id, doc);
export const loadSceneDoc = async (id: string): Promise<SceneDocument | null> =>
  (await get<SceneDocument>(SCENE_PREFIX + id)) ?? null;
export const deleteSceneDoc = (id: string) => del(SCENE_PREFIX + id);

export const saveRoomDoc = (roomId: string, doc: SceneDocument) =>
  set(ROOM_PREFIX + roomId, doc);
export const loadRoomDoc = async (
  roomId: string,
): Promise<SceneDocument | null> =>
  (await get<SceneDocument>(ROOM_PREFIX + roomId)) ?? null;
export const deleteRoomDoc = (roomId: string) => del(ROOM_PREFIX + roomId);

export const saveSatchelItems = (items: unknown) => set(SATCHEL_SLOT, items);
export const loadSatchelItems = async <T>(): Promise<T | null> =>
  (await get<T>(SATCHEL_SLOT)) ?? null;

export const saveRemoteCache = (state: CachedRemoteState) =>
  set(META_SLOT, state);
export const loadRemoteCache = async (): Promise<CachedRemoteState | null> =>
  (await get<CachedRemoteState>(META_SLOT)) ?? null;

export const clearAllLocalData = async () => {
  const allKeys = await keys();
  await Promise.all(
    allKeys
      .filter(
        (k) =>
          typeof k === "string" &&
          (k.startsWith(SCENE_PREFIX) ||
            k.startsWith(ROOM_PREFIX) ||
            k === META_SLOT ||
            k === SATCHEL_SLOT ||
            k === ENC_KEY_SLOT ||
            k === KEYS_SLOT ||
            k === ARK_SLOT ||
            k === RING_SLOT ||
            k === USER_ID_SLOT),
      )
      .map((k) => del(k)),
  );
};
