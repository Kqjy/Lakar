import { RoughCanvas } from "roughjs/bin/canvas";
import type { Theme, LakarElement } from "../types";
import { isLinearLike } from "../types";
import { getElementBounds } from "../elements";
import { themedColor } from "../colors";
import { getElementShape } from "./shapes";
import { getCachedImage } from "./imageCache";
import { getFontString, measureText } from "../text/measure";

export const FRAME_LABEL_HEIGHT = 22;

export const renderElement = (
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  el: LakarElement,
  theme: Theme,
  opacityMultiplier = 1,
  zoom = 1,
) => {
  const bounds = getElementBounds(el);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  ctx.save();
  ctx.globalAlpha = (el.opacity / 100) * opacityMultiplier;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.translate(cx, cy);
  if (el.angle) ctx.rotate(el.angle);
  ctx.translate(-(bounds.maxX - bounds.minX) / 2, -(bounds.maxY - bounds.minY) / 2);

  if (el.type === "frame") {
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    ctx.fillStyle = theme === "dark" ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.55)";
    ctx.strokeStyle = theme === "dark" ? "#524e45" : "#c9c2b4";
    ctx.lineWidth = 1.4 / zoom;
    const r = Math.min(8 / zoom, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.max(0, r));
    ctx.fill();
    ctx.stroke();
    ctx.font = `500 ${12 / zoom}px "Inter Variable", -apple-system, sans-serif`;
    ctx.fillStyle = theme === "dark" ? "#a6a08f" : "#8a8578";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(el.name || "Frame", 1 / zoom, -8 / zoom);
    ctx.restore();
    return;
  }

  if (el.type === "text") {
    ctx.font = getFontString(el.fontFamily, el.fontSize);
    ctx.fillStyle = themedColor(el.strokeColor, theme);
    ctx.textBaseline = "alphabetic";
    const { lines, lineWidths, width } = measureText(
      el.text,
      el.fontFamily,
      el.fontSize,
      el.lineHeight,
    );
    const lineH = el.fontSize * el.lineHeight;

    const baselineOffset = el.fontSize * 0.82 + (lineH - el.fontSize) / 2;
    lines.forEach((line, i) => {
      let dx = 0;
      if (el.textAlign === "center") dx = (width - lineWidths[i]) / 2;
      else if (el.textAlign === "right") dx = width - lineWidths[i];
      ctx.fillText(line, dx, i * lineH + baselineOffset);
    });
    ctx.restore();
    return;
  }

  if (el.type === "image") {
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    const img = getCachedImage(el.dataURL);
    if (img) {
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.strokeStyle = theme === "dark" ? "#4a473f" : "#d4cfc2";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(0, 0, w, h);
      ctx.fillStyle = theme === "dark" ? "#2a292644" : "#f5f3ee88";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    return;
  }

  const shape = getElementShape(el, theme);

  if (el.type === "freedraw") {
    if (shape.freedrawPath) {
      ctx.fillStyle = themedColor(el.strokeColor, theme);

      ctx.translate(el.x - bounds.minX, el.y - bounds.minY);
      ctx.fill(shape.freedrawPath);
    }
    ctx.restore();
    return;
  }

  if (isLinearLike(el)) {

    ctx.translate(el.x - bounds.minX, el.y - bounds.minY);
  }

  for (const d of shape.drawables) rc.draw(d);
  ctx.restore();
};
