import type { Point, Viewport } from "../types";

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

interface Trail {
  points: TrailPoint[];
  done: boolean;
}

const FADE_MS = 850;
const COLOR = "#e0432d";

export class LaserManager {
  private trails: Trail[] = [];
  private raf = 0;
  private canvas: HTMLCanvasElement | null = null;
  private getViewport: (() => Viewport) | null = null;
  private getSize: (() => { w: number; h: number; dpr: number }) | null = null;

  attach(
    canvas: HTMLCanvasElement,
    getViewport: () => Viewport,
    getSize: () => { w: number; h: number; dpr: number },
  ) {
    this.canvas = canvas;
    this.getViewport = getViewport;
    this.getSize = getSize;
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.trails = [];
    this.canvas = null;
  }

  start(p: Point) {
    this.trails.push({ points: [{ x: p.x, y: p.y, t: performance.now() }], done: false });
    this.ensureLoop();
  }

  move(p: Point) {
    const trail = this.trails[this.trails.length - 1];
    if (trail && !trail.done) {
      trail.points.push({ x: p.x, y: p.y, t: performance.now() });
    }
  }

  end() {
    const trail = this.trails[this.trails.length - 1];
    if (trail) trail.done = true;
  }

  private ensureLoop() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.raf = 0;
    const canvas = this.canvas;
    if (!canvas || !this.getViewport || !this.getSize) return;
    const ctx = canvas.getContext("2d")!;
    const { w, h, dpr } = this.getSize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w * dpr, h * dpr);

    const now = performance.now();
    for (const trail of this.trails) {
      const cutoff = now - FADE_MS;
      const firstFresh = trail.points.findIndex((pt) => pt.t >= cutoff);
      if (firstFresh > 0) trail.points.splice(0, firstFresh);
      else if (firstFresh === -1) {
        trail.points.splice(0, trail.done ? trail.points.length : trail.points.length - 1);
      }
    }
    this.trails = this.trails.filter((t) => t.points.length > 0);

    const vp = this.getViewport();
    const toScreen = (pt: TrailPoint): Point => ({
      x: (pt.x - vp.scrollX) * vp.zoom,
      y: (pt.y - vp.scrollY) * vp.zoom,
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLOR;
    ctx.shadowColor = COLOR;
    for (const trail of this.trails) {
      const pts = trail.points;
      for (let i = 1; i < pts.length; i++) {
        const k = Math.max(0, 1 - (now - pts[i].t) / FADE_MS);
        const a = toScreen(pts[i - 1]);
        const b = toScreen(pts[i]);
        ctx.globalAlpha = 0.15 + 0.75 * k;
        ctx.lineWidth = 1 + 2.8 * k;
        ctx.shadowBlur = 7 * k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      if (pts.length === 1 && !trail.done) {
        const p = toScreen(pts[0]);
        ctx.globalAlpha = 0.9;
        ctx.shadowBlur = 7;
        ctx.fillStyle = COLOR;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (this.trails.length) this.raf = requestAnimationFrame(this.tick);
  };
}
