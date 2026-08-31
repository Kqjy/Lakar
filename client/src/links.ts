import type { LakarElement } from "./types";
import { linkBadgeFor } from "./elements";

export const SCENE_LINK_PREFIX = "lakar:scene/";

export const isSceneLink = (link: string) => link.startsWith(SCENE_LINK_PREFIX);

export const sceneIdFromLink = (link: string) =>
  link.slice(SCENE_LINK_PREFIX.length);

export const makeSceneLink = (sceneId: string) =>
  `${SCENE_LINK_PREFIX}${sceneId}`;

export const normalizeLink = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  if (isSceneLink(value)) {
    return sceneIdFromLink(value) ? value : null;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (url.username || url.password) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(value)) {
    return `https://${value}`;
  }
  return null;
};

export const hitLinkBadge = (
  elements: readonly LakarElement[],
  point: { x: number; y: number },
  zoom: number,
): LakarElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || !el.link) continue;
    const badge = linkBadgeFor(el, zoom);
    if (Math.hypot(point.x - badge.cx, point.y - badge.cy) <= badge.r) {
      return el;
    }
  }
  return null;
};

export const getLinkedElements = (
  elements: readonly LakarElement[],
): LakarElement[] => elements.filter((el) => !el.isDeleted && !!el.link);
