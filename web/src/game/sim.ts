// Cosmetic battle simulation: heroes mirror agent state, enemies exist to be fought.
import type { Activity, AgentState } from "../../../shared/protocol";
import { pcColorIndex } from "../../../shared/colors";
import { ago } from "../dom";
import { type Strip, U, drawStrip, frameCount, img, loaded } from "./art";
import { describe } from "./describe";
import { type Sprite, hash, textSprite } from "./pix";
import {
  ARROW,
  BOOM,
  BUBBLE,
  CLASS_LABEL,
  CLASS_OF,
  type CharSprites,
  DUST,
  type EnemyKind,
  type HeroClass,
  PC_COLORS,
  WISP,
  enemySprites,
  heroSprites,
} from "./sprites";
import type { Layout, Prop, Pt } from "./world";

const BOSS_AFTER_MS = 10 * 60_000;
const RANGED: Record<HeroClass, boolean> = { monk: true, archer: true, warrior: false };
/** Height above the feet of the middle of a figure, where blows land. */
const MID = 10;

interface Hero {
  id: string;
  a: AgentState;
  cls: HeroClass;
  spr: CharSprites;
  /** index into PC_COLORS */
  color: number;
  x: number;
  y: number;
  path: Pt[];
  home: Pt;
  slot: Pt;
  inField: boolean;
  facing: 1 | -1;
  moving: boolean;
  walkT: number;
  /** time left in the current attack animation, and which attack strip is playing */
  atkT: number;
  atkIdx: number;
  /** the blow that lands part-way through the attack animation */
  pending: { target: Enemy; act: Activity | null } | null;
  phase: number;
  cooldown: number;
  spawnT: number;
  wanderT: number;
  wispT: number;
  specials: Activity[];
  seenKills: number;
}

interface Enemy {
  owner: string;
  kind: EnemyKind;
  spr: CharSprites;
  x: number;
  y: number;
  hp: number;
  angle: number;
  state: "approach" | "fight" | "flee";
  fleeTo: Pt;
  facing: 1 | -1;
  walkT: number;
  flashT: number;
  atkT: number;
  cooldown: number;
  life: number;
}

/** A one-shot animated effect from a sprite strip. */
interface Fx {
  s: Strip;
  x: number;
  y: number;
  t: number;
  dur: number;
  scale: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  grav: number;
}
interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  r: number;
  color: string;
}
interface Shot {
  x: number;
  y: number;
  target: Enemy;
  from: Hero;
  arrow: boolean;
  act: Activity | null;
}

const busy = (a: AgentState) => a.status !== "idle";
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Name ribbons: drawn at this scale from the pack's small ribbons, one pair of 64px rows per faction colour. */
const RIBBON = 0.56;
const FONT = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
const LABEL_FONT = `700 5px ${FONT}`;
/** Speech bubble colours, sampled from the pack's paper. */
const PAPER = "#eee1c6";
const PAPER_EDGE = "#161c2e";
/** Ink that reads on each faction's ribbon (blue, red, yellow, purple). */
const RIBBON_INK = ["#ffffff", "#ffffff", "#3a2d2a", "#ffffff"];
const LABEL: Record<string, string> = { working: "#ffe9a8", waiting: "#ff9a80", idle: "#d8e6f4", stale: "#9aa3ad" };

export class Sim {
  heroes = new Map<string, Hero>();
  enemies: Enemy[] = [];
  particles: Particle[] = [];
  rings: Ring[] = [];
  shots: Shot[] = [];
  fx: Fx[] = [];
  shake = 0;
  selected: string | null = null;
  private first = true;
  private wisp: Sprite = WISP();
  private bubble: Sprite = BUBBLE();
  private t = 0;
  private now = 0;

  constructor(public L: Layout) {}

  setLayout(L: Layout): void {
    this.L = L;
    this.enemies = [];
    this.shots = [];
    for (const h of this.heroes.values()) {
      h.home = this.homeFor(h.id);
      h.path = [];
    }
    this.assignSlots();
    for (const h of this.heroes.values()) {
      const p = h.inField ? h.slot : h.home;
      h.x = p.x;
      h.y = p.y;
    }
  }

  // ------------------------------------------------------------ state sync

  sync(agents: Map<string, AgentState>, now: number): void {
    for (const [id, h] of this.heroes) {
      if (!agents.has(id)) {
        this.puff(h.x, h.y);
        this.poof(h.x, h.y - MID, "#b46cff", 10);
        this.heroes.delete(id);
      }
    }
    for (const a of agents.values()) {
      let h = this.heroes.get(a.id);
      if (!h) {
        const home = this.homeFor(a.id);
        const start = this.first ? home : { x: this.L.portal.x, y: this.L.portal.y + 6 };
        h = {
          id: a.id,
          a,
          cls: CLASS_OF[a.agent] ?? "warrior",
          spr: heroSprites(a.agent, pcColorIndex(a.pcColor, hash(a.pcId))),
          color: pcColorIndex(a.pcColor, hash(a.pcId)),
          x: start.x,
          y: start.y,
          path: [],
          home,
          slot: home,
          inField: false,
          facing: 1,
          moving: false,
          walkT: 0,
          atkT: 0,
          atkIdx: 0,
          pending: null,
          phase: Math.random() * 8,
          cooldown: 0.5,
          spawnT: 0.3,
          wanderT: 1 + Math.random() * 3,
          wispT: 0,
          specials: [],
          seenKills: a.kills,
        };
        this.heroes.set(a.id, h);
        if (!this.first) this.poof(h.x, h.y - MID, "#b46cff", 14);
        if (!this.first && !busy(a)) h.path = [home];
      } else {
        if (h.a.pcColor !== a.pcColor) {
          h.color = pcColorIndex(a.pcColor, hash(a.pcId));
          h.spr = heroSprites(a.agent, h.color);
        }
        if (a.kills > h.seenKills && a.activity) {
          for (let i = 0; i < Math.min(3, a.kills - h.seenKills); i++) if (h.specials.length < 3) h.specials.push(a.activity);
        }
        h.seenKills = a.kills;
        h.a = a;
      }
    }
    this.assignSlots();
    for (const h of this.heroes.values()) {
      const want = busy(h.a);
      if (want !== h.inField) {
        h.inField = want;
        if (this.first && want) {
          h.x = h.slot.x;
          h.y = h.slot.y;
        } else this.route(h);
      } else if (want && h.path.length) {
        h.path[h.path.length - 1] = h.slot;
      } else if (want && dist(h, h.slot) > 3) {
        h.path = [h.slot];
      }
    }
    this.first = false;
    void now;
  }

  private homeFor(id: string): Pt {
    const p = this.L.plaza;
    const hsh = hash(id);
    return { x: p.x + 8 + (hsh % Math.max(1, p.w - 16)), y: p.y + 5 + ((hsh >>> 9) % Math.max(1, p.h - 7)) };
  }

  private assignSlots(): void {
    const f = this.L.field;
    const list = [...this.heroes.values()].filter((h) => busy(h.a)).sort((p, q) => p.a.since - q.a.since || (p.id < q.id ? -1 : 1));
    const n = list.length;
    const cols = Math.max(1, Math.min(n, Math.floor(f.w / 56)));
    const rows = Math.ceil(n / cols);
    list.forEach((h, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? n - row * cols : cols;
      h.slot = {
        x: Math.round(f.x + (f.w * (col + 0.5)) / inRow),
        y: Math.round(f.y + f.h * (rows === 1 ? 0.42 : (row + 0.5) / rows)),
      };
    });
  }

  private route(h: Hero): void {
    const { gateIn: inside, gateOut: outside, vh } = this.L;
    const inVillage = h.y < vh;
    if (h.inField) h.path = inVillage ? [inside, outside, h.slot] : [h.slot];
    else h.path = inVillage ? [h.home] : [outside, inside, h.home];
  }

  // ---------------------------------------------------------------- update

  update(dt: number, now: number): void {
    this.t += dt;
    this.now = now;
    this.shake = Math.max(0, this.shake - dt * 12);

    for (const h of this.heroes.values()) {
      h.atkT = Math.max(0, h.atkT - dt);
      if (h.pending && h.atkT <= h.spr.attackTime * (1 - h.spr.release)) this.release(h);
      h.wispT = Math.max(0, h.wispT - dt);
      h.moving = false;
      if (h.path.length) {
        const speed = h.inField || h.y > this.L.vh ? 40 : 30;
        this.stepToward(h, h.path[0], speed * dt);
        h.moving = true;
        h.walkT += dt;
        if (dist(h, h.path[0]) < 1) h.path.shift();
        continue;
      }
      if (!h.inField) {
        h.wanderT -= dt;
        if (h.wanderT <= 0) {
          h.wanderT = 3 + Math.random() * 6;
          const p = this.L.plaza;
          h.path = [
            {
              x: Math.max(p.x + 4, Math.min(p.x + p.w - 4, h.home.x + (Math.random() - 0.5) * 50)),
              y: Math.max(p.y + 4, Math.min(p.y + p.h - 2, h.home.y + (Math.random() - 0.5) * 16)),
            },
          ];
        }
        continue;
      }
      if (h.a.status === "working") this.fight(h, dt, now);
    }

    this.updateEnemies(dt);
    this.updateShots(dt);

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.dur);
  }

  /** The moment in an attack animation where the arrow leaves the bow or the sword connects. */
  private release(h: Hero): void {
    const { target, act } = h.pending!;
    h.pending = null;
    if (!this.enemies.includes(target)) return;
    if (RANGED[h.cls]) {
      this.shots.push({ x: h.x + h.facing * 6, y: h.y - MID - 2, target, from: h, arrow: h.cls === "archer", act });
    } else {
      this.slash(target.x, target.y - MID, h.facing);
      this.hit(h, target, act);
    }
  }

  private stepToward(o: { x: number; y: number; facing: 1 | -1 }, to: Pt, step: number): void {
    const dx = to.x - o.x;
    const dy = to.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      o.x = to.x;
      o.y = to.y;
    } else {
      o.x += (dx / d) * step;
      o.y += (dy / d) * step;
    }
    if (Math.abs(dx) > 0.5) o.facing = dx > 0 ? 1 : -1;
  }

  private fight(h: Hero, dt: number, now: number): void {
    // keep the right number of foes coming
    const mine = this.enemies.filter((e) => e.owner === h.id && e.state !== "flee");
    const wantBoss = now - h.a.since > BOSS_AFTER_MS;
    const want = 1 + Math.min(2, Math.floor(h.a.kills / 6)) + (wantBoss ? 1 : 0);
    h.spawnT -= dt;
    if (mine.length < want && h.spawnT <= 0) {
      h.spawnT = 0.7 + Math.random() * 0.9;
      this.spawn(h, wantBoss && !mine.some((e) => e.kind === "boss") ? "boss" : null);
    }

    let target: Enemy | null = null;
    let best = Infinity;
    for (const e of mine) {
      const d = dist(h, e);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    h.cooldown -= dt;
    if (!target) return;
    h.facing = target.x >= h.x ? 1 : -1;
    const ranged = RANGED[h.cls];
    if (best > (ranged ? 130 : 30) || h.cooldown > 0) return;

    const act = h.specials.shift() ?? null;
    h.cooldown = (act ? 0.65 : h.a.activity === "think" ? 1.5 : 1.0) + Math.random() * 0.3;
    h.atkT = h.spr.attackTime;
    h.atkIdx = (h.atkIdx + 1) % h.spr.attacks.length;
    h.pending = { target, act };
  }

  private spawn(h: Hero, force: EnemyKind | null): void {
    const sp = this.L.spawns;
    const order = sp.map((p, i) => ({ i, d: dist(p, h) + Math.random() * 120 })).sort((a, b) => a.d - b.d);
    const idx = order[0].i;
    const kind: EnemyKind = force ?? (idx === 0 ? "lancer" : idx === 1 ? "raider" : Math.random() < 0.6 ? "raider" : "lancer");
    const p = sp[idx];
    this.enemies.push({
      owner: h.id,
      kind,
      spr: enemySprites(kind),
      x: p.x + (Math.random() - 0.5) * 6,
      y: p.y + (Math.random() - 0.5) * 6,
      hp: kind === "boss" ? 1e9 : kind === "lancer" ? 3 : 2,
      angle: Math.random() * Math.PI * 2,
      state: "approach",
      fleeTo: p,
      facing: 1,
      walkT: Math.random(),
      flashT: 0,
      atkT: 0,
      cooldown: 1 + Math.random(),
      life: 0,
    });
  }

  private updateEnemies(dt: number): void {
    const keep: Enemy[] = [];
    for (const e of this.enemies) {
      e.life += dt;
      e.flashT = Math.max(0, e.flashT - dt);
      e.atkT = Math.max(0, e.atkT - dt);
      const h = this.heroes.get(e.owner);
      const wanted = h && h.inField && (h.a.status === "working" || h.a.status === "waiting");
      if (!wanted && e.state !== "flee") {
        e.state = "flee";
        e.fleeTo = this.L.spawns.reduce((a, b) => (dist(b, e) < dist(a, e) ? b : a));
      }
      const base = e.kind === "raider" ? 32 : e.kind === "lancer" ? 24 : 18;
      if (e.state === "flee") {
        this.stepToward(e, e.fleeTo, base * 2.4 * dt);
        e.walkT += dt * 2;
        if (dist(e, e.fleeTo) < 2) continue;
        keep.push(e);
        continue;
      }
      const waiting = h!.a.status === "waiting";
      if (waiting) e.angle += dt * 0.9;
      const reach = (e.kind === "boss" ? 30 : 19) + (waiting ? 12 : 0);
      const goal = { x: h!.x + Math.cos(e.angle) * reach, y: h!.y + Math.sin(e.angle) * reach * 0.6 };
      const d = dist(e, goal);
      if (d > 1.5) {
        this.stepToward(e, goal, base * dt);
        e.walkT += dt;
        e.state = d > 6 ? "approach" : "fight";
      } else e.state = "fight";
      if (e.state === "fight") {
        e.facing = h!.x >= e.x ? 1 : -1;
        e.cooldown -= dt;
        if (e.cooldown <= 0 && !waiting) {
          e.cooldown = 1.1 + Math.random() * 0.9;
          e.atkT = e.spr.attackTime;
        }
      }
      keep.push(e);
    }
    this.enemies = keep;
  }

  private updateShots(dt: number): void {
    const keep: Shot[] = [];
    for (const s of this.shots) {
      if (!this.enemies.includes(s.target)) continue;
      const to = { x: s.target.x, y: s.target.y - MID };
      const d = dist(s, to);
      const step = 190 * dt;
      if (d <= step + 2) {
        this.hit(s.from, s.target, s.act);
        continue;
      }
      s.x += ((to.x - s.x) / d) * step;
      s.y += ((to.y - s.y) / d) * step;
      if (!s.arrow) this.spark(s.x, s.y, "#b9f06a", 1, 10);
      keep.push(s);
    }
    this.shots = keep;
  }

  private hit(h: Hero, e: Enemy, act: Activity | null): void {
    e.flashT = 0.12;
    const dx = e.x - h.x;
    const dy = e.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    if (e.kind !== "boss") {
      e.x += (dx / d) * 3;
      e.y += (dy / d) * 2;
    }
    const x = e.x;
    const y = e.y - MID;
    switch (act) {
      case "edit":
        this.spark(x, y, "#ffd23c", 7, 60);
        break;
      case "command":
        this.rings.push({ x, y: e.y, life: 0.35, max: 0.35, r: 20, color: "#ff9d3c" });
        this.spark(x, y, "#ff9d3c", 6, 70);
        this.fx.push({ s: BOOM, x, y, t: 0, dur: 0.6, scale: 1 });
        this.shake = 3;
        break;
      case "search":
      case "read":
        this.rings.push({ x, y, life: 0.25, max: 0.25, r: 9, color: "#7fe3ff" });
        this.spark(x, y, "#7fe3ff", 5, 45);
        break;
      case "web":
        this.rings.push({ x, y, life: 0.4, max: 0.4, r: 13, color: "#b46cff" });
        this.spark(x, y, "#b46cff", 8, 40);
        break;
      case "subagent":
        h.wispT = 8;
        this.spark(x, y, "#f4efe6", 6, 50);
        break;
      default:
        this.spark(x, y, "#f4efe6", 2, 30);
    }
    e.hp -= act ? 99 : 1;
    if (e.hp <= 0) {
      this.puff(e.x, e.y);
      this.enemies = this.enemies.filter((o) => o !== e);
    }
  }

  // --------------------------------------------------------------- effects

  private spark(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      const life = 0.2 + Math.random() * 0.25;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: 1, grav: 90 });
    }
  }

  private poof(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 8 + Math.random() * 22;
      const life = 0.3 + Math.random() * 0.4;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, life, max: life, color: i % 3 ? color : "#f4efe6", size: 2, grav: -10 });
    }
  }

  private puff(x: number, y: number): void {
    this.fx.push({ s: DUST, x, y: y - 4, t: 0, dur: 0.7, scale: 1 });
  }

  private slash(x: number, y: number, dir: number): void {
    for (let i = 0; i < 6; i++) {
      const a = -1 + i * 0.4;
      const life = 0.12 + i * 0.012;
      this.particles.push({ x: x + Math.cos(a) * 6 * dir, y: y + Math.sin(a) * 7, vx: dir * 12, vy: 0, life, max: life, color: "#f4efe6", size: 1, grav: 0 });
    }
  }

  // ------------------------------------------------------------------ draw

  /**
   * `px` is device pixels per world unit, used to keep the chunky overlays on whole pixels;
   * `cssPx` is CSS pixels per world unit, used to keep the speech bubble readable on small screens.
   */
  draw(g: CanvasRenderingContext2D, props: Prop[], px: number, cssPx: number): void {
    type Item = { y: number; hero?: Hero; enemy?: Enemy; prop?: Prop };
    const items: Item[] = props.map((prop) => ({ y: prop.y, prop }));
    for (const h of this.heroes.values()) items.push({ y: h.y, hero: h });
    for (const e of this.enemies) items.push({ y: e.y, enemy: e });
    items.sort((a, b) => a.y - b.y);
    const smooth = g.imageSmoothingEnabled;
    const snap = (v: number) => Math.round(v * px) / px;

    for (const it of items) {
      if (it.hero) this.drawHero(g, it.hero, snap);
      else if (it.enemy) this.drawEnemy(g, it.enemy);
      else it.prop!.draw(g, this.t);
    }

    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const rad = 2 + r.r * k;
      g.fillStyle = r.color;
      g.globalAlpha = 1 - k * 0.7;
      const n = Math.ceil(rad * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        g.fillRect(Math.round(r.x + Math.cos(a) * rad), Math.round(r.y + Math.sin(a) * rad * 0.6), 1, 1);
      }
      g.globalAlpha = 1;
    }

    for (const f of this.fx) drawStrip(g, f.s, (f.t / f.dur) * frameCount(f.s), f.x, f.y, { scale: f.scale });

    for (const s of this.shots) {
      if (s.arrow) {
        drawStrip(g, ARROW, 0, s.x, s.y, { rot: Math.atan2(s.target.y - MID - s.y, s.target.x - s.x) });
      } else {
        g.fillStyle = "#b9f06a";
        g.fillRect(snap(s.x - 1.5), snap(s.y - 1.5), 3, 3);
        g.fillStyle = "#f6ffe0";
        g.fillRect(snap(s.x - 0.5), snap(s.y - 0.5), 1, 1);
      }
    }

    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      g.fillStyle = p.color;
      g.fillRect(snap(p.x), snap(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;

    g.imageSmoothingEnabled = false;
    for (const h of this.heroes.values()) this.drawLabel(g, h, snap);
    const sel = this.selected ? this.heroes.get(this.selected) : undefined;
    if (sel) this.drawBubble(g, sel, snap, cssPx);
    g.imageSmoothingEnabled = smooth;
  }

  /** Speech bubble over the selected hero saying what its agent is doing. */
  private drawBubble(g: CanvasRenderingContext2D, h: Hero, snap: (v: number) => number, cssPx: number): void {
    const a = h.a;
    // at least 11 CSS pixels tall, whatever the zoom
    const f1 = Math.max(4.5, 11 / cssPx);
    const f2 = f1 * 0.85;
    const line1 = describe(a) + (a.status === "working" && a.kills ? ` - ${a.kills} slain` : "");
    const line2 = `${CLASS_LABEL[h.cls]} (${a.agent}) on ${a.pc} - ${ago(this.now - a.since)}`;
    const font1 = `700 ${f1}px ${FONT}`;
    const font2 = `400 ${f2}px ${FONT}`;
    g.font = font1;
    const w1 = g.measureText(line1).width;
    g.font = font2;
    const w2 = g.measureText(line2).width;
    const pad = f1 * 0.8;
    const w = Math.max(w1, w2) + pad * 2;
    const ht = f1 + f2 + f1 * 0.4 + pad * 1.7;
    const tail = f1 * 0.9;

    // above the name ribbon, or below the hero when there is no room; kept on screen sideways
    const x = snap(Math.max(2, Math.min(this.L.W - 2 - w, h.x - w / 2)));
    let y = h.y - h.spr.h - 11 - tail - ht;
    const below = y < 2;
    if (below) y = h.y + 3 + tail;
    y = snap(y);

    const paper = img("ui_paper");
    if (loaded(paper)) {
      // nine pieces of the pack's paper: 52x44 corners (trimmed of their padding) drawn c units wide
      const c = f1 * 0.9;
      const k = c / 52;
      const sx = [12, 128, 256];
      const sw = [52, 64, 52];
      const sy = [20, 128, 256];
      const sh = [44, 64, 45];
      const dx = [x, x + c, x + w - c];
      const dw = [c, w - c * 2, c];
      const dy = [y, y + 44 * k, y + ht - 45 * k];
      const dh = [44 * k, ht - 89 * k, 45 * k];
      g.imageSmoothingEnabled = true;
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) g.drawImage(paper, sx[q], sy[r], sw[q], sh[r], dx[q], dy[r], dw[q] + 0.05, dh[r] + 0.05);
      g.imageSmoothingEnabled = false;
    } else {
      g.fillStyle = PAPER_EDGE;
      g.fillRect(x - 0.4, y - 0.4, w + 0.8, ht + 0.8);
      g.fillStyle = PAPER;
      g.fillRect(x, y, w, ht);
    }

    // tail pointing at the hero
    const tx = Math.max(x + tail * 1.6, Math.min(x + w - tail * 1.6, h.x));
    const base = below ? y + 0.5 : y + ht - 0.5;
    const tip = below ? y - tail : y + ht + tail;
    g.beginPath();
    g.moveTo(tx - tail * 0.8, base);
    g.lineTo(tx, tip);
    g.lineTo(tx + tail * 0.8, base);
    g.fillStyle = PAPER;
    g.fill();
    g.strokeStyle = PAPER_EDGE;
    g.lineWidth = Math.max(0.3, f1 * 0.07);
    g.lineJoin = "round";
    g.stroke();

    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = font1;
    g.fillStyle = "#3a2d2a";
    g.fillText(line1, x + pad, y + pad * 0.85);
    g.font = font2;
    g.fillStyle = "#7d6a56";
    g.fillText(line2, x + pad, y + pad * 0.85 + f1 * 1.4);
  }

  private drawChar(
    g: CanvasRenderingContext2D,
    spr: CharSprites,
    o: { x: number; y: number; facing: 1 | -1; walkT: number; atkT: number },
    atkIdx: number,
    moving: boolean,
    phase: number,
    flash: boolean,
  ): void {
    let s = spr.idle;
    let frame = this.t * 10 + phase;
    if (o.atkT > 0) {
      s = spr.attacks[atkIdx % spr.attacks.length];
      frame = Math.min(0.999, 1 - o.atkT / spr.attackTime) * frameCount(s);
    } else if (moving) {
      s = spr.run;
      frame = o.walkT * 10;
    }
    drawStrip(g, s, frame, o.x, o.y, { flip: o.facing < 0, scale: spr.scale, flash });
  }

  private drawHero(g: CanvasRenderingContext2D, h: Hero, snap: (v: number) => number): void {
    if (this.selected === h.id) {
      g.fillStyle = "#ffe9a8";
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + this.t * 2;
        g.fillRect(snap(h.x + Math.cos(a) * 13), snap(h.y - 1 + Math.sin(a) * 6), 1, 1);
      }
    }
    if (h.a.status === "stale") g.globalAlpha = 0.45;
    this.drawChar(g, h.spr, h, h.atkIdx, h.moving, h.phase, false);
    g.globalAlpha = 1;
    if (h.wispT > 0) {
      const a = this.t * 3;
      const smooth = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = false;
      g.drawImage(this.wisp, snap(h.x + Math.cos(a) * 14 - 2), snap(h.y - 14 + Math.sin(a) * 5));
      g.imageSmoothingEnabled = smooth;
    }
  }

  private drawEnemy(g: CanvasRenderingContext2D, e: Enemy): void {
    if (e.life < 0.4) g.globalAlpha = e.life / 0.4;
    this.drawChar(g, e.spr, e, 0, e.state !== "fight", e.life * 3, e.flashT > 0);
    g.globalAlpha = 1;
  }

  private drawLabel(g: CanvasRenderingContext2D, h: Hero, snap: (v: number) => number): void {
    const name = (h.a.name || h.a.project || h.a.pc).slice(0, 20);
    const ribbons = img("ui_ribbons_small");
    let top = h.y - h.spr.h - 9;
    if (!loaded(ribbons)) {
      // without the pack's ribbons, fall back to outlined pixel text
      const s = textSprite(name, LABEL[h.a.status]);
      g.drawImage(s, snap(h.x - s.width / 2), snap(top));
    } else {
      // a ribbon in the PC's faction colour: two end caps and a middle stretched to fit the name
      const k = RIBBON / U;
      const cap = 64 * k;
      top = h.y - h.spr.h - cap - 1;
      g.font = LABEL_FONT;
      const mid = Math.max(1, g.measureText(name).width - cap * 0.75);
      const x0 = snap(h.x - mid / 2 - cap);
      const y0 = snap(top);
      const row = h.color * 128;
      g.imageSmoothingEnabled = true;
      g.globalAlpha = h.a.status === "stale" ? 0.5 : 1;
      g.drawImage(ribbons, 0, row, 64, 64, x0, y0, cap, cap);
      // overlap the joins slightly so no seam shows at fractional zoom
      g.drawImage(ribbons, 128, row, 64, 64, x0 + cap - 0.2, y0, mid + 0.4, cap);
      g.drawImage(ribbons, 256, row, 64, 64, x0 + cap + mid, y0, cap, cap);
      g.imageSmoothingEnabled = false;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const ink = RIBBON_INK[h.color] ?? "#ffffff";
      if (ink === "#ffffff") {
        g.fillStyle = "rgba(20,40,60,0.7)";
        g.fillText(name, h.x, y0 + cap * 0.44 + 0.4);
      }
      g.fillStyle = ink;
      g.fillText(name, h.x, y0 + cap * 0.44);
      g.globalAlpha = 1;
    }
    // the selected hero's speech bubble takes the badge's place
    if (h.a.status === "waiting" && this.selected !== h.id) {
      const bob = Math.sin(this.t * 5) > 0 ? 1 : 0;
      const badge = img("ui_badge_red");
      if (!loaded(badge)) {
        g.drawImage(this.bubble, snap(h.x - 3), snap(top - 12 - bob));
        return;
      }
      // the pack's red round button with an exclamation mark
      const size = 10;
      const by = snap(top - size - bob);
      g.imageSmoothingEnabled = true;
      g.drawImage(badge, snap(h.x - size / 2), by, size, size);
      g.imageSmoothingEnabled = false;
      g.font = '700 7px ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(90,20,20,0.8)";
      g.fillText("!", h.x, by + size * 0.47 + 0.5);
      g.fillStyle = "#ffffff";
      g.fillText("!", h.x, by + size * 0.47);
    }
  }

  pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = 16;
    for (const h of this.heroes.values()) {
      const d = Math.hypot(h.x - x, h.y - MID - y);
      if (d < bd) {
        bd = d;
        best = h.id;
      }
    }
    return best;
  }
}
