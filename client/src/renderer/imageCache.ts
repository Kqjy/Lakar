const cache = new Map<string, HTMLImageElement>();
let notifyLoad: (() => void) | null = null;

export const setImageLoadNotifier = (fn: (() => void) | null) => {
  notifyLoad = fn;
};

export const getCachedImage = (dataURL: string): HTMLImageElement | null => {
  let img = cache.get(dataURL);
  if (!img) {
    img = new Image();
    img.onload = () => notifyLoad?.();
    img.src = dataURL;
    cache.set(dataURL, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
};

export const preloadImages = (dataURLs: Iterable<string>): Promise<void> =>
  Promise.all(
    [...dataURLs].map(
      (url) =>
        new Promise<void>((resolve) => {
          const existing = cache.get(url);
          if (existing?.complete) return resolve();
          const img = existing ?? new Image();
          if (!existing) {
            img.src = url;
            cache.set(url, img);
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
