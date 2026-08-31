import { RoughCanvas } from "roughjs/bin/canvas";
import type { Theme, LakarElement } from "../types";
import { preloadImages } from "../renderer/imageCache";
import { getCommonBounds } from "../elements";
import { renderElement } from "../renderer/renderElement";
import { generator, getElementShape } from "../renderer/shapes";
import { themedColor } from "../colors";
import { getElementBounds } from "../elements";
import { isLinearLike } from "../types";
import { FONT_FAMILY_CSS, measureText } from "../text/measure";
export { downloadBlob } from "./download";
import { downloadBlob } from "./download";

const PADDING = 24;

export interface ExportOptions {
  elements: readonly LakarElement[];
  theme: Theme;
  background: string | null;
  scale: number;
}

export const getExportSize = (
  elements: readonly LakarElement[],
  scale: number,
): { width: number; height: number } => {
  const visible = elements.filter((el) => !el.isDeleted);
  const bounds = getCommonBounds(visible);
  return {
    width: Math.round(Math.max(bounds.maxX - bounds.minX + PADDING * 2, 10) * scale),
    height: Math.round(Math.max(bounds.maxY - bounds.minY + PADDING * 2, 10) * scale),
  };
};

export const renderToCanvas = ({
  elements,
  theme,
  background,
  scale,
}: ExportOptions): HTMLCanvasElement => {
  const visible = elements.filter((el) => !el.isDeleted);
  const bounds = getCommonBounds(visible);
  const width = Math.max(bounds.maxX - bounds.minX + PADDING * 2, 10);
  const height = Math.max(bounds.maxY - bounds.minY + PADDING * 2, 10);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  if (background) {
    ctx.fillStyle = themedColor(background, theme);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    (-bounds.minX + PADDING) * scale,
    (-bounds.minY + PADDING) * scale,
  );
  const rc = new RoughCanvas(canvas);
  for (const el of visible) renderElement(ctx, rc, el, theme);
  return canvas;
};

const preloadSceneImages = (elements: readonly LakarElement[]) =>
  preloadImages(
    elements
      .filter((el) => !el.isDeleted && el.type === "image")
      .map((el) => (el as { dataURL: string }).dataURL),
  );

export const exportPNG = async (opts: ExportOptions, filename: string) => {
  await preloadSceneImages(opts.elements);
  const canvas = renderToCanvas(opts);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (blob) downloadBlob(blob, filename);
};

export const copyPNGToClipboard = async (opts: ExportOptions) => {
  await preloadSceneImages(opts.elements);
  const canvas = renderToCanvas(opts);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("render failed");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
};

const escapeXML = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const exportSVG = ({
  elements,
  theme,
  background,
}: Omit<ExportOptions, "scale">, filename: string) => {
  const visible = elements.filter((el) => !el.isDeleted);
  const bounds = getCommonBounds(visible);
  const width = Math.max(bounds.maxX - bounds.minX + PADDING * 2, 10);
  const height = Math.max(bounds.maxY - bounds.minY + PADDING * 2, 10);
  const offX = -bounds.minX + PADDING;
  const offY = -bounds.minY + PADDING;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(
      2,
    )} ${height.toFixed(2)}" width="${Math.round(width)}" height="${Math.round(height)}">`,
  );
  if (background) {
    parts.push(
      `<rect width="100%" height="100%" fill="${themedColor(background, theme)}"/>`,
    );
  }

  for (const el of visible) {
    const b = getElementBounds(el);
    const cx = (b.minX + b.maxX) / 2 + offX;
    const cy = (b.minY + b.maxY) / 2 + offY;
    const deg = ((el.angle * 180) / Math.PI).toFixed(3);
    const transform = el.angle ? ` transform="rotate(${deg} ${cx.toFixed(2)} ${cy.toFixed(2)})"` : "";
    const opacity = el.opacity < 100 ? ` opacity="${(el.opacity / 100).toFixed(2)}"` : "";
    parts.push(`<g${transform}${opacity}>`);

    if (el.type === "image") {
      parts.push(
        `<image href="${el.dataURL}" x="${(b.minX + offX).toFixed(2)}" y="${(
          b.minY + offY
        ).toFixed(2)}" width="${Math.abs(el.width).toFixed(2)}" height="${Math.abs(
          el.height,
        ).toFixed(2)}" preserveAspectRatio="none"/>`,
      );
      parts.push("</g>");
      continue;
    }

    if (el.type === "text") {
      const { lines, lineWidths, width: tw } = measureText(
        el.text,
        el.fontFamily,
        el.fontSize,
        el.lineHeight,
      );
      const lineH = el.fontSize * el.lineHeight;
      const baseline = el.fontSize * 0.82 + (lineH - el.fontSize) / 2;
      const color = themedColor(el.strokeColor, theme);
      const family = escapeXML(FONT_FAMILY_CSS[el.fontFamily]);
      lines.forEach((line, i) => {
        let dx = 0;
        if (el.textAlign === "center") dx = (tw - lineWidths[i]) / 2;
        else if (el.textAlign === "right") dx = tw - lineWidths[i];
        parts.push(
          `<text x="${(el.x + dx + offX).toFixed(2)}" y="${(
            el.y + i * lineH + baseline + offY
          ).toFixed(2)}" font-family='${family}' font-size="${el.fontSize}" fill="${color}">${escapeXML(line)}</text>`,
        );
      });
      parts.push("</g>");
      continue;
    }

    const shape = getElementShape(el, theme);
    const lx = isLinearLike(el) ? el.x + offX : b.minX + offX;
    const ly = isLinearLike(el) ? el.y + offY : b.minY + offY;

    if (el.type === "freedraw") {
      if (shape.freedrawD) {
        parts.push(
          `<path d="${shape.freedrawD}" fill="${themedColor(
            el.strokeColor,
            theme,
          )}" transform="translate(${lx.toFixed(2)} ${ly.toFixed(2)})"/>`,
        );
      }
      parts.push("</g>");
      continue;
    }

    const dash =
      el.strokeStyle === "dashed"
        ? `${8} ${8 + el.strokeWidth}`
        : el.strokeStyle === "dotted"
          ? `${1.5} ${6 + el.strokeWidth}`
          : null;
    parts.push(`<g transform="translate(${lx.toFixed(2)} ${ly.toFixed(2)})">`);
    for (const drawable of shape.drawables) {
      for (const info of generator.toPaths(drawable)) {
        const fill = info.fill && info.fill !== "none" ? info.fill : "none";
        const stroked = info.stroke && info.stroke !== "none";
        parts.push(
          `<path d="${info.d}" stroke="${info.stroke ?? "none"}" stroke-width="${info.strokeWidth}" fill="${fill}"${
            dash && stroked ? ` stroke-dasharray="${dash}"` : ""
          } stroke-linecap="round"/>`,
        );
      }
    }
    parts.push("</g></g>");
  }
  parts.push("</svg>");
  const blob = new Blob([parts.join("\n")], { type: "image/svg+xml" });
  downloadBlob(blob, filename);
};

