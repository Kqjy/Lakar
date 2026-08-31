import { useStore } from "./store";
import { api, ApiError } from "./sync/api";
import { syncManager } from "./sync/manager";
import { decryptJSON, encryptJSON } from "./crypto/e2ee";
import {
  buildPublishLink,
  isPublishPath,
  newPublishSecret,
  parsePublishLocation,
  publishKeyFromSecret,
} from "./crypto/publish";
import { serializeScene, type SceneDocument } from "./export/json";
import { history } from "./history";
import { zoomToFit } from "./interaction/view";
import { LOCAL_PUBLISH_KEY } from "./constants";

interface PublishRecord {
  id: string;
  secret: string;
  title: string;
  updatedAt: number;
}

type PublishIndex = Record<string, PublishRecord>;

const readIndex = (): PublishIndex => {
  try {
    const raw = localStorage.getItem(LOCAL_PUBLISH_KEY);
    return raw ? (JSON.parse(raw) as PublishIndex) : {};
  } catch {
    return {};
  }
};

const writeIndex = (index: PublishIndex) => {
  try {
    localStorage.setItem(LOCAL_PUBLISH_KEY, JSON.stringify(index));
  } catch {
    void 0;
  }
};

export const getPublishRecord = (sceneId: string): PublishRecord | null =>
  readIndex()[sceneId] ?? null;

export const syncPublishRecords = async (): Promise<void> => {
  if (!syncManager.isSignedIn()) return;
  let items;
  try {
    ({ items } = await api.listPublished());
  } catch {
    return;
  }
  const index = readIndex();
  const live = new Set(items.map((it) => it.id));
  for (const item of items) {
    if (!item.sceneId) continue;
    if (item.encSecret) {
      const secret = await syncManager.decryptPublishSecret(
        item.id,
        item.encSecret,
      );
      if (secret) {
        index[item.sceneId] = {
          id: item.id,
          secret,
          title: index[item.sceneId]?.title ?? "Shared canvas",
          updatedAt: item.updatedAt,
        };
      }
      continue;
    }
    const local = index[item.sceneId];
    if (local?.id === item.id) {
      const encSecret = await syncManager.encryptPublishSecret(
        item.id,
        local.secret,
      );
      if (encSecret) {
        try {
          await api.setPublishedSecret(item.id, encSecret);
        } catch {
          void 0;
        }
      }
    }
  }
  for (const [sceneId, record] of Object.entries(index)) {
    if (!live.has(record.id)) delete index[sceneId];
  }
  writeIndex(index);
};

export const publishCurrentScene = async (): Promise<string | null> => {
  const s = useStore.getState();
  if (!s.user) {
    s.toast("Sign in to publish a read-only link", "error");
    return null;
  }
  const sceneId = s.sceneId;
  if (!sceneId) {
    s.toast("Save this scene before publishing", "error");
    return null;
  }

  const index = readIndex();
  const existing = index[sceneId];
  const secret = existing?.secret ?? newPublishSecret();
  const key = await publishKeyFromSecret(secret);
  const doc = serializeScene(s.elements, s.canvasBg);
  const payload = { ...doc, title: s.sceneTitle };
  const encData = await encryptJSON(key, payload);
  const publishId = existing?.id ?? syncManager.newRecordId();
  const encSecret = await syncManager.encryptPublishSecret(publishId, secret);

  try {
    let id: string;
    let updatedAt: number;
    if (existing) {
      const res = await api.updatePublished(existing.id, encData);
      id = existing.id;
      updatedAt = res.updatedAt;
      if (encSecret) {
        await api.setPublishedSecret(id, encSecret).catch(() => void 0);
      }
    } else {
      const res = await api.createPublished(encData, sceneId, encSecret, publishId);
      id = res.id;
      updatedAt = res.updatedAt;
    }
    index[sceneId] = { id, secret, title: s.sceneTitle, updatedAt };
    writeIndex(index);
    return buildPublishLink(id, secret);
  } catch (err) {
    if (err instanceof ApiError && err.code === "quota") {
      s.toast("You have reached the published page limit", "error");
    } else if (err instanceof ApiError && err.status === 404 && existing) {
      delete index[sceneId];
      writeIndex(index);
      s.toast("That page was removed — publish again to get a new link", "error");
    } else {
      s.toast("Could not publish — check your connection", "error");
    }
    return null;
  }
};

export const unpublishCurrentScene = async (): Promise<boolean> => {
  const s = useStore.getState();
  const sceneId = s.sceneId;
  if (!sceneId) return false;
  const index = readIndex();
  const record = index[sceneId];
  if (!record) return false;
  try {
    await api.deletePublished(record.id);
  } catch {
    s.toast("Could not reach the server", "error");
    return false;
  }
  delete index[sceneId];
  writeIndex(index);
  return true;
};

export const publishLinkFor = (sceneId: string): string | null => {
  const record = readIndex()[sceneId];
  return record ? buildPublishLink(record.id, record.secret) : null;
};

export const tryEnterViewerMode = async (): Promise<boolean> => {
  if (!isPublishPath()) return false;
  const s = useStore.getState();
  s.setViewerMode(true);
  const parts = parsePublishLocation();
  if (!parts) {
    s.setViewerLoadFailed(true);
    return true;
  }
  try {
    const key = await publishKeyFromSecret(parts.secret);
    const { encData } = await api.getPublished(parts.id);
    const doc = await decryptJSON<SceneDocument & { title?: string }>(
      key,
      encData,
    );
    s.replaceElements(doc.elements ?? []);
    s.setCanvasBg(doc.appState?.canvasBg ?? s.canvasBg);
    s.setScene(null, doc.title || "Shared canvas");
    history.reset();
    zoomToFit();
    return true;
  } catch {
    s.setViewerLoadFailed(true);
    return true;
  }
};
