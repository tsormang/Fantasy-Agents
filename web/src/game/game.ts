// Canvas, resize handling, render loop and ambient animation (water, foam, smoke, night).
import type { Store } from "../store";
import { observeSize } from "../resize";
import { U, drawStrip, whenLoaded } from "./art";
import { type Sprite, canvas } from "./pix";
import { Sim } from "./sim";
import { DUST } from "./sprites";
import { type Layout, WATER, drawFoam, makeLayout, paintLand } from "./world";

interface Smoke {
  x: number;
  y: number;
  life: number;
}

function glowSprite(r: number, color: string): Sprite {
  const [c, g] = canvas(r * 2 + 1, r * 2 + 1);
  // three stepped discs rather than a smooth gradient
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

/** Radius, in world units, of the light each hero carries. */
const HERO_GLOW = 26;

function nightFactor(): number {
  const q = new URLSearchParams(location.search).get("night");
  if (q !== null) return q === "" || Number.isNaN(Number(q)) ? 1 : Math.max(0, Math.min(1, Number(q)));
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
  private land!: Sprite;
  private glows: Sprite[] = [];
  private heroGlow = glowSprite(HERO_GLOW, "255,214,140");
  /** device pixels per world unit (always a whole number) and CSS pixels per world unit */
  private s = 4;
  private unitCss = 4;
  private smooth = false;
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
    void whenLoaded("tiles").then(() => (this.land = paintLand(this.L)));
    // Wait for the first snapshot so heroes already at work start on the field, not at the portal.
    const sync = () => store.ready && this.sim.sync(store.agents, store.now());
    sync();
    store.onChange(sync);

    let pending = 0;
    // Observe the container (not just the window) so a pane that starts hidden or tiny still gets laid out.
    let seen = `${root.clientWidth}x${root.clientHeight}`;
    observeSize(root, () => {
      const size = `${root.clientWidth}x${root.clientHeight}`;
      if (size === seen) return;
      seen = size;
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        this.layout();
        this.sim.setLayout(this.L);
      }, 120);
    });
    this.el.addEventListener("PointerEvent" in window ? "pointerdown" : "mousedown", (e) => {
      const r = this.el.getBoundingClientRect();
      const id = this.sim.pick((e.clientX - r.left) / this.unitCss, (e.clientY - r.top) / this.unitCss);
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
    const dpr = window.devicePixelRatio || 1;
    // Aim for about 270 world units on the short side, with the art scaled in quarter steps
    // so that one world unit is always a whole number of device pixels.
    const zoom = Math.max(0.25, Math.round(((Math.min(w, h) / 270) * dpr * 4) / U) / 4);
    this.s = zoom * U;
    this.unitCss = this.s / dpr;
    this.smooth = zoom % 1 !== 0;
    const W = Math.ceil(w / this.unitCss);
    const H = Math.ceil(h / this.unitCss);
    this.el.width = Math.round(w * dpr);
    this.el.height = Math.round(h * dpr);
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.L = makeLayout(W, H);
    this.land = paintLand(this.L);
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
    const { L, t, s } = this;
    const sh = this.sim.shake;
    const jx = sh ? Math.round((Math.random() - 0.5) * sh) : 0;
    const jy = sh ? Math.round((Math.random() - 0.5) * sh) : 0;
    g.setTransform(s, 0, 0, s, jx * s, jy * s);
    g.imageSmoothingEnabled = this.smooth;
    g.imageSmoothingQuality = "high";

    g.fillStyle = WATER;
    g.fillRect(-4, -4, L.W + 8, L.H + 8);
    drawFoam(g, L, t);
    g.drawImage(this.land, 0, 0, L.W, L.H);
    for (const p of L.afloat) p.draw(g, t);

    this.sim.draw(g, L.props, s, this.unitCss);

    // chimney smoke
    if (Math.random() < dt * 1.6 && L.chimneys.length) {
      const c = L.chimneys[(Math.random() * L.chimneys.length) | 0];
      this.smoke.push({ x: c.x, y: c.y, life: 0 });
    }
    for (const p of this.smoke) {
      p.life += dt;
      p.y -= dt * 5;
      p.x += Math.sin(p.life * 2 + p.y) * dt * 2;
      g.globalAlpha = Math.max(0, 0.6 - p.life * 0.22);
      drawStrip(g, DUST, 2 + p.life * 2.6, p.x, p.y, { scale: 0.4 + p.life * 0.12 });
    }
    g.globalAlpha = 1;
    this.smoke = this.smoke.filter((p) => p.life < 2.6);


    // night tint, then lights on top
    g.setTransform(s, 0, 0, s, 0, 0);
    g.imageSmoothingEnabled = false;
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
    // each hero carries a warm light: faint by day, a lantern at night
    for (const h of this.sim.heroes.values()) {
      const a = (0.22 + 0.7 * this.night) * (h.a.status === "stale" ? 0.4 : 1) * (0.93 + 0.07 * Math.sin(t * 5 + h.x));
      g.globalAlpha = a;
      g.drawImage(this.heroGlow, h.x - HERO_GLOW, h.y - 9 - HERO_GLOW);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}
