import type { Point } from "../types";
import { insertImageBlobs, isImageLike } from "./images";
import { pasteText } from "./actions";

export const imageFilesFrom = (data: DataTransfer): File[] => {
  const files = [...data.files].filter(isImageLike);
  if (files.length) return files;
  const out: File[] = [];
  for (const item of data.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isImageLike(file)) out.push(file);
  }
  return out;
};

export const hasFiles = (data: DataTransfer | null) =>
  !!data && [...data.types].includes("Files");

export const consumeTransfer = (
  data: DataTransfer | null,
  scenePoint: Point | null,
): boolean => {
  if (!data) return false;
  const images = imageFilesFrom(data);
  if (images.length) {
    void insertImageBlobs(images, scenePoint);
    return true;
  }
  const text = data.getData("text/plain");
  if (text) {
    pasteText(text, scenePoint);
    return true;
  }
  return false;
};
