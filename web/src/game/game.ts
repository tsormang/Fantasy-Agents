// Canvas, resize handling, render loop and ambient animation (fires, portal, smoke, night).
import type { Store } from "../store";
import { type Sprite, canvas } from "./pix";
import { Sim } from "./sim";
import { type Layout, makeLayout, paintWorld } from "./world";

interface Smoke {
  x: number;
  y: number;
  life: number;
}

function glowSprite(r: number, color: string): Sprite {
  const [c, g] = canvas(r * 2 + 1, r * 2 + 1);
  // three stepped discs rather than a smooth gradient, to stay in pixel style
  for (const [k, a] of [[1, 0.1], [0.66, 0.12], [0.36, 0.16]]) {
    const rad = Math.round(r * k);
    g.fillStyle = `rgba(${color},${a})`;
    for (let dy = -rad; dy <= rad; dy++) {
      const half = Math.round(Math.sqrt(rad * rad - dy * dy));
      g.fillRect(r - half, r + dy, half * 2 + 1, 1);
    }
  }
  return c;
}

function nightFactor(): number {
  const q = new URLSearchParams(location.search).get("night");
  if (q !== null) return Math.max(0, Math.min(1, Number(q) || 1));
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 5) return 1;
  if (h < 7) return (7 - h) / 2;
  if (h < 18) return 0;
  if (h < 20.5) return (h - 18) / 2.5;
  return 1;
}

export class Game {
  readonly el: HTMLCanvasElement;
  readonly sim: Sim;
  onSelect: (id: string | null) => void = () => {};
  private g: CanvasRenderingContext2D;
  private L!: Layout;
  private bg!: Sprite;
  private glows: Sprite[] = [];
  private scale = 1;
  private last = 0;
  private t = 0;
  private smoke: Smoke[] = [];
  private night = nightFactor();

  constructor(
    private root: HTMLElement,
    private store: Store,
  ) {
    this.el = document.createElement("canvas");
    this.el.className = "field";
    this.g = this.el.getContext("2d")!;
    root.appendChild(this.el);
    this.layout();
    this.sim = new Sim(this.L);
    // Wait for the first snapshot so heroes already at work start on the field, not at the portal.
    const sync = () => store.ready && this.sim.sync(store.agents, store.now());
    sync();
    store.onChange(sync);

    let pending = 0;
    // Observe the container (not just the window) so a pane that starts hidden or tiny still gets laid out.
    let seen = `${root.clientWidth}x${root.clientHeight}`;
    new ResizeObserver(() => {
      const size = `${root.clientWidth}x${root.clientHeight}`;
      if (size === seen) return;
      seen = size;
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        this.layout();
        this.sim.setLayout(this.L);
      }, 120);
    }).observe(root);
    this.el.addEventListener("pointerdown", (e) => {
      const r = this.el.getBoundingClientRect();
      const id = this.sim.pick((e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale);
      this.select(id);
      this.onSelect(id);
    });
    setInterval(() => (this.night = nightFactor()), 60_000);
    requestAnimationFrame((ts) => this.frame(ts));
  }

  select(id: string | null): void {
    this.sim.selected = id;
  }

  private layout(): void {
    const w = Math.max(160, this.root.clientWidth);
    const h = Math.max(160, this.root.clientHeight);
    this.scale = Math.max(1, Math.round(Math.min(w, h) / 250));
    const W = Math.ceil(w / this.scale);
    const H = Math.ceil(h / this.scale);
    this.el.width = W;
    this.el.height = H;
    this.el.style.width = `${W * this.scale}px`;
    this.el.style.height = `${H * this.scale}px`;
    this.g.imageSmoothingEnabled = false;
    this.L = makeLayout(W, H);
    this.bg = paintWorld(this.L);
    this.glows = this.L.glows.map((gl) => glowSprite(gl.r, gl.color));
    this.smoke = [];
  }

  private frame(ts: number): void {
    const dt = Math.min(0.05, (ts - this.last) / 1000 || 0);
    this.last = ts;
    this.t += dt;
    this.sim.update(dt, this.store.now());
    this.draw(dt);
    requestAnimationFrame((n) => this.frame(n));
  }

  private draw(dt: number): void {
    const g = this.g;
    const { L, t } = this;
    const sh = this.sim.shake;
    g.setTransform(1, 0, 0, 1, sh ? Math.round((Math.random() - 0.5) * sh) : 0, sh ? Math.round((Math.random() - 0.5) * sh) : 0);
    g.drawImage(this.bg, 0, 0);

    // portal swirl inside the keep doorway
    const p = L.portal;
    for (let i = 0; i < 14; i++) {
      const a = t * 2.2 + i * 0.9;
      const rad = 1 + (i % 7);
      g.fillStyle = i % 3 === 0 ? "#f0d8ff" : i % 3 === 1 ? "#b46cff" : "#7a3fb8";
      g.fillRect(Math.round(p.x + Math.cos(a) * rad), Math.round(p.y - 7 + Math.sin(a) * rad * 1.3), 1, 1);
    }

    // flames
    for (const f of L.flames) {
      const k = Math.floor(t * 9 + f.x) % 3;
      g.fillStyle = "#e0483c";
      g.fillRect(f.x - 2, f.y - 1, 4, 3);
      g.fillStyle = "#ff9d3c";
      g.fillRect(f.x - 1, f.y - 3 - (k === 0 ? 1 : 0), 2, 4);
      g.fillStyle = "#ffe07a";
      g.fillRect(f.x - (k === 1 ? 1 : 0), f.y - 2, 1, 2);
    }

    // chimney smoke
    if (Math.random() < dt * 2.2 && L.chimneys.length) {
      const c = L.chimneys[(Math.random() * L.chimneys.length) | 0];
      this.smoke.push({ x: c.x, y: c.y, life: 0 });
    }
    for (const s of this.smoke) {
      s.life += dt;
      s.y -= dt * 6;
      s.x += Math.sin(s.life * 2 + s.y) * dt * 3;
      g.globalAlpha = Math.max(0, 0.55 - s.life * 0.2);
      g.fillStyle = "#d9dde6";
      const sz = s.life > 1.2 ? 3 : 2;
      g.fillRect(Math.round(s.x), Math.round(s.y), sz, sz);
    }
    g.globalAlpha = 1;
    this.smoke = this.smoke.filter((s) => s.life < 2.6 && s.y > -4);

    this.sim.draw(g);

    // night tint, then lights on top
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.night > 0) {
      g.fillStyle = `rgba(14,18,58,${0.5 * this.night})`;
      g.fillRect(0, 0, L.W, L.H);
    }
    g.globalCompositeOperation = "lighter";
    L.glows.forEach((gl, i) => {
      const flick = gl.always ? 0.85 + 0.15 * Math.sin(t * 7 + i * 2.3) : 1;
      const a = (gl.always ? 0.55 + 0.45 * this.night : this.night) * flick;
      if (a <= 0.02) return;
      g.globalAlpha = a;
      g.drawImage(this.glows[i], gl.x - gl.r, gl.y - gl.r);
    });
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}
