import type { Point, Viewport } from "../types";

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

interface Trail {
  points: TrailPoint[];
  done: boolean;
  color: string;
  remote: boolean;
}

const FADE_MS = 850;
const REMOTE_STALE_MS = 2000;
const COLOR = "#e0432d";
const SELF = "self";

export class LaserManager {
  private trails: Trail[] = [];
  private current = new Map<string, Trail>();
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
    this.current.clear();
    this.canvas = null;
  }

  start(p: Point) {
    this.begin(SELF, COLOR, false, p);
  }

  move(p: Point) {
    const trail = this.current.get(SELF);
    if (trail && !trail.done) {
      trail.points.push({ x: p.x, y: p.y, t: performance.now() });
    }
  }

  end() {
    this.finish(SELF);
  }

  remote(id: string, color: string, pts: Point[], done: boolean) {
    let trail = this.current.get(id);
    const now = performance.now();
    for (const p of pts) {
      if (!trail || trail.done) {
        trail = { points: [], done: false, color, remote: true };
        this.trails.push(trail);
        this.current.set(id, trail);
      }
      trail.points.push({ x: p.x, y: p.y, t: now });
    }
    if (done) this.finish(id);
    if (pts.length) this.ensureLoop();
  }

  clearRemote(id: string) {
    this.finish(id);
  }

  clearAllRemote() {
    for (const [id, trail] of this.current) {
      if (trail.remote) {
        trail.done = true;
        this.current.delete(id);
      }
    }
  }

  private begin(id: string, color: string, remote: boolean, p: Point) {
    const trail: Trail = {
      points: [{ x: p.x, y: p.y, t: performance.now() }],
      done: false,
      color,
      remote,
    };
    this.trails.push(trail);
    this.current.set(id, trail);
    this.ensureLoop();
  }

  private finish(id: string) {
    const trail = this.current.get(id);
    if (trail) {
      trail.done = true;
      this.current.delete(id);
    }
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
      if (
        trail.remote &&
        !trail.done &&
        trail.points.length &&
        now - trail.points[trail.points.length - 1].t > REMOTE_STALE_MS
      ) {
        trail.done = true;
        for (const [id, t] of this.current) {
          if (t === trail) this.current.delete(id);
        }
      }
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
    for (const trail of this.trails) {
      ctx.strokeStyle = trail.color;
      ctx.shadowColor = trail.color;
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
        ctx.fillStyle = trail.color;
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

export const laserManager = new LaserManager();
