import { useStore } from "../store";
import { syncManager } from "../sync/manager";
import { isSceneLink, normalizeLink, sceneIdFromLink } from "../links";

export const linkLabel = (link: string): string => {
  if (isSceneLink(link)) {
    const id = sceneIdFromLink(link);
    const scene = useStore.getState().scenes.find((s) => s.id === id);
    return scene ? scene.title : "another scene";
  }
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
};

export const openLink = (link: string) => {
  const s = useStore.getState();
  const safe = normalizeLink(link);
  if (!safe) {
    s.toast("That link was blocked — it is not a web address", "error");
    return;
  }
  if (isSceneLink(safe)) {
    const id = sceneIdFromLink(safe);
    if (!s.scenes.some((scene) => scene.id === id)) {
      s.toast("That scene is no longer here", "error");
      return;
    }
    void syncManager.openScene(id);
    return;
  }
  window.open(safe, "_blank", "noopener,noreferrer");
};
