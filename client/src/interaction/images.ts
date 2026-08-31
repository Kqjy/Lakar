import { useStore } from "../store";
import type { ImageElement, Point } from "../types";
import { newElementId, newVersionNonce } from "../elements";
import { randomSeed } from "../math";
import { history } from "../history";
import { pasteFromClipboard, viewportCenter } from "./actions";
import { syncManager } from "../sync/manager";

const MAX_DIMENSION = 2048;
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const MAX_BATCH = 12;
const STACK_OFFSET = 26;
const ACCEPTED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const typeOf = (blob: Blob): string => {
  if (blob.type.startsWith("image/")) return blob.type;
  const name = (blob as File).name;
  if (!name) return blob.type;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return blob.type;
  return EXTENSION_TYPES[name.slice(dot + 1).toLowerCase()] ?? blob.type;
};

export const isImageLike = (blob: Blob) => typeOf(blob).startsWith("image/");

const readAsDataURL = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });

const loadDims = (dataURL: string): Promise<{ w: number; h: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ w: img.naturalWidth || 300, h: img.naturalHeight || 300 });
    img.onerror = () => reject(new Error("decode failed"));
    img.src = dataURL;
  });

const processBlob = async (
  blob: Blob,
  type: string,
): Promise<{ dataURL: string; w: number; h: number }> => {
  const source = blob.type === type ? blob : new Blob([blob], { type });
  const raw = await readAsDataURL(source);
  const dims = await loadDims(raw);
  const needsResize =
    type !== "image/svg+xml" &&
    (dims.w > MAX_DIMENSION || dims.h > MAX_DIMENSION || source.size > MAX_RAW_BYTES);
  if (!needsResize && ACCEPTED.has(type)) {
    return { dataURL: raw, ...dims };
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(dims.w, dims.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(dims.w * scale);
  canvas.height = Math.round(dims.h * scale);
  const ctx = canvas.getContext("2d")!;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("decode failed"));
    img.src = raw;
  });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const isOpaqueSource = type === "image/jpeg";
  const dataURL = isOpaqueSource
    ? canvas.toDataURL("image/jpeg", 0.87)
    : canvas.toDataURL("image/png");
  return { dataURL, w: canvas.width, h: canvas.height };
};

const buildElement = (
  dataURL: string,
  w: number,
  h: number,
  target: Point,
): ImageElement => {
  const s = useStore.getState();
  const maxW = (window.innerWidth * 0.55) / s.viewport.zoom;
  const maxH = (window.innerHeight * 0.55) / s.viewport.zoom;
  const fit = Math.min(1, maxW / w, maxH / h);
  const width = Math.max(20, w * fit);
  const height = Math.max(20, h * fit);
  return {
    id: newElementId(),
    type: "image",
    x: target.x - width / 2,
    y: target.y - height / 2,
    width,
    height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundEdges: false,
    seed: randomSeed(),
    version: 1,
    versionNonce: newVersionNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    dataURL,
  };
};

export const insertImageBlobs = async (
  blobs: readonly Blob[],
  scenePoint: Point | null = null,
) => {
  const s = useStore.getState();
  const usable = blobs.filter(isImageLike);
  if (!usable.length) {
    s.toast(
      "That file type isn't supported — use PNG, JPEG, WebP, GIF, or SVG",
      "error",
    );
    return;
  }
  if (usable.length > MAX_BATCH) {
    s.toast(`Only the first ${MAX_BATCH} images were added`, "info");
  }
  const origin = scenePoint ?? viewportCenter();
  const step = STACK_OFFSET / useStore.getState().viewport.zoom;
  const canvasAtStart = s.sceneId;
  const roomAtStart = syncManager.currentRoomSceneId();
  const created: ImageElement[] = [];
  let failed = 0;

  for (const [index, blob] of usable.slice(0, MAX_BATCH).entries()) {
    try {
      const { dataURL, w, h } = await processBlob(blob, typeOf(blob));
      if (dataURL.length > 8 * 1024 * 1024) {
        failed++;
        continue;
      }
      created.push(
        buildElement(dataURL, w, h, {
          x: origin.x + index * step,
          y: origin.y + index * step,
        }),
      );
    } catch {
      failed++;
    }
  }

  if (!created.length) {
    s.toast("Could not read that image", "error");
    return;
  }
  const current = useStore.getState();
  if (
    current.sceneId !== canvasAtStart ||
    syncManager.currentRoomSceneId() !== roomAtStart
  ) {
    current.toast(
      "You moved to another canvas while that image was loading, so it was not added",
      "info",
    );
    return;
  }
  if (failed) {
    s.toast(
      failed === 1
        ? "One image could not be added — it was unreadable or too large"
        : `${failed} images could not be added — they were unreadable or too large`,
      "error",
    );
  }
  current.replaceElements([...current.elements, ...created]);
  current.setSelectedIds(created.map((el) => el.id));
  if (current.activeTool !== "selection") current.setTool("selection");
  history.commit();
};

export const insertImageBlob = (blob: Blob, scenePoint: Point | null = null) =>
  insertImageBlobs([blob], scenePoint);

export const insertImageFromPicker = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = () => {
    const files = input.files ? [...input.files] : [];
    if (files.length) void insertImageBlobs(files, null);
  };
  input.click();
};

export const tryPasteImage = async (
  scenePoint: Point | null,
): Promise<boolean> => {
  try {
    const items = await navigator.clipboard.read();
    const blobs: Blob[] = [];
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (imageType) blobs.push(await item.getType(imageType));
    }
    if (!blobs.length) return false;
    await insertImageBlobs(blobs, scenePoint);
    return true;
  } catch {
    return false;
  }
};

export const pasteSmart = async (scenePoint: Point | null) => {
  if (await tryPasteImage(scenePoint)) return;
  await pasteFromClipboard(scenePoint);
};
