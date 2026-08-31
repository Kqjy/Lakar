import { useStore } from "../store";
import type { ImageElement, Point } from "../types";
import { newElementId, newVersionNonce } from "../elements";
import { randomSeed } from "../math";
import { history } from "../history";
import { pasteFromClipboard, viewportCenter } from "./actions";

const MAX_DIMENSION = 2048;
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const ACCEPTED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

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
): Promise<{ dataURL: string; w: number; h: number }> => {
  const raw = await readAsDataURL(blob);
  const dims = await loadDims(raw);
  const needsResize =
    blob.type !== "image/svg+xml" &&
    (dims.w > MAX_DIMENSION || dims.h > MAX_DIMENSION || blob.size > MAX_RAW_BYTES);
  if (!needsResize && ACCEPTED.has(blob.type)) {
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
  const isOpaqueSource = blob.type === "image/jpeg";
  const dataURL = isOpaqueSource
    ? canvas.toDataURL("image/jpeg", 0.87)
    : canvas.toDataURL("image/png");
  return { dataURL, w: canvas.width, h: canvas.height };
};

export const insertImageBlob = async (
  blob: Blob,
  scenePoint: Point | null = null,
) => {
  const s = useStore.getState();
  if (!ACCEPTED.has(blob.type)) {
    s.toast("That file type isn't supported — use PNG, JPEG, WebP, GIF, or SVG", "error");
    return;
  }
  try {
    const { dataURL, w, h } = await processBlob(blob);
    if (dataURL.length > 8 * 1024 * 1024) {
      s.toast("Image is too large after processing", "error");
      return;
    }
    const maxW = (window.innerWidth * 0.55) / s.viewport.zoom;
    const maxH = (window.innerHeight * 0.55) / s.viewport.zoom;
    const fit = Math.min(1, maxW / w, maxH / h);
    const width = Math.max(20, w * fit);
    const height = Math.max(20, h * fit);
    const target = scenePoint ?? viewportCenter();
    const el: ImageElement = {
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
    s.replaceElements([...s.elements, el]);
    s.setSelectedIds([el.id]);
    if (s.activeTool !== "selection") s.setTool("selection");
    history.commit();
  } catch {
    s.toast("Could not read that image", "error");
  }
};

export const insertImageFromPicker = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void insertImageBlob(file, null);
  };
  input.click();
};

export const tryPasteImage = async (
  scenePoint: Point | null,
): Promise<boolean> => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (imageType) {
        const blob = await item.getType(imageType);
        await insertImageBlob(blob, scenePoint);
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
};

export const pasteSmart = async (scenePoint: Point | null) => {
  if (await tryPasteImage(scenePoint)) return;
  await pasteFromClipboard(scenePoint);
};
