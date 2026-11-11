// Cosmetic battle simulation: heroes mirror agent state, enemies exist to be fought.
import type { Activity, AgentState } from "../../../shared/protocol";
import { type Sprite, drawText, hash } from "./pix";
import { BUBBLE, CLASS_OF, type CharSprites, type EnemyKind, type HeroClass, WISP, enemySprites, heroSprites } from "./sprites";
import type { Layout, Pt } from "./world";

const BOSS_AFTER_MS = 10 * 60_000;
const RANGED: Record<HeroClass, boolean> = { mage: true, ranger: true, barbarian: false, squire: false };

interface Hero {
  id: string;
  a: AgentState;
  cls: HeroClass;
  spr: CharSprites;
  x: number;
  y: number;
  path: Pt[];
  home: Pt;
  slot: Pt;
  inField: boolean;
  facing: 1 | -1;
  moving: boolean;
  walkT: number;
  strikeT: number;
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
  lungeT: number;
  cooldown: number;
  life: number;
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
const LABEL: Record<string, string> = { working: "#ffe9a8", waiting: "#ff9a80", idle: "#d8e6f4", stale: "#9aa3ad" };

export class Sim {
  heroes = new Map<string, Hero>();
  enemies: Enemy[] = [];
  particles: Particle[] = [];
  rings: Ring[] = [];
  shots: Shot[] = [];
  shake = 0;
  selected: string | null = null;
  private first = true;
  private wisp: Sprite = WISP();
  private bubble: Sprite = BUBBLE();
  private t = 0;

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
        this.poof(h.x, h.y - 8, "#b46cff", 14);
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
          cls: CLASS_OF[a.agent] ?? "squire",
          spr: heroSprites(a.agent, hash(a.pcId) % 8),
          x: start.x,
          y: start.y,
          path: [],
          home,
          slot: home,
          inField: false,
          facing: 1,
          moving: false,
          walkT: 0,
          strikeT: 0,
          cooldown: 0.5,
          spawnT: 0.3,
          wanderT: 1 + Math.random() * 3,
          wispT: 0,
          specials: [],
          seenKills: a.kills,
        };
        this.heroes.set(a.id, h);
        if (!this.first) this.poof(h.x, h.y - 8, "#b46cff", 14);
        if (!this.first && !busy(a)) h.path = [home];
      } else {
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
    const { gate, vh } = this.L;
    const inside = { x: gate.x, y: vh - 8 };
    const outside = { x: gate.x, y: vh + 12 };
    const inVillage = h.y < vh;
    if (h.inField) h.path = inVillage ? [inside, outside, h.slot] : [h.slot];
    else h.path = inVillage ? [h.home] : [outside, inside, h.home];
  }

  // ---------------------------------------------------------------- update

  update(dt: number, now: number): void {
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 12);

    for (const h of this.heroes.values()) {
      h.strikeT = Math.max(0, h.strikeT - dt);
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
    if (best > (ranged ? 120 : 24) || h.cooldown > 0) return;

    const act = h.specials.shift() ?? null;
    h.cooldown = (act ? 0.45 : h.a.activity === "think" ? 1.5 : 1.0) + Math.random() * 0.3;
    h.strikeT = 0.22;
    if (ranged) {
      this.shots.push({ x: h.x + h.facing * 7, y: h.y - 10, target, from: h, arrow: h.cls === "ranger", act });
    } else {
      this.slash(target.x, target.y - 7, h.facing);
      this.hit(h, target, act);
    }
  }

  private spawn(h: Hero, force: EnemyKind | null): void {
    const sp = this.L.spawns;
    const order = sp.map((p, i) => ({ i, d: dist(p, h) + Math.random() * 120 })).sort((a, b) => a.d - b.d);
    const idx = order[0].i;
    const kind: EnemyKind = force ?? (idx === 0 ? "skeleton" : idx === 1 ? "goblin" : Math.random() < 0.6 ? "goblin" : "skeleton");
    const p = sp[idx];
    this.enemies.push({
      owner: h.id,
      kind,
      spr: enemySprites(kind),
      x: p.x + (Math.random() - 0.5) * 6,
      y: p.y + (Math.random() - 0.5) * 6,
      hp: kind === "boss" ? 1e9 : kind === "skeleton" ? 3 : 2,
      angle: Math.random() * Math.PI * 2,
      state: "approach",
      fleeTo: p,
      facing: 1,
      walkT: Math.random(),
      flashT: 0,
      lungeT: 0,
      cooldown: 1 + Math.random(),
      life: 0,
    });
  }

  private updateEnemies(dt: number): void {
    const keep: Enemy[] = [];
    for (const e of this.enemies) {
      e.life += dt;
      e.flashT = Math.max(0, e.flashT - dt);
      e.lungeT = Math.max(0, e.lungeT - dt);
      const h = this.heroes.get(e.owner);
      const wanted = h && h.inField && (h.a.status === "working" || h.a.status === "waiting");
      if (!wanted && e.state !== "flee") {
        e.state = "flee";
        e.fleeTo = this.L.spawns.reduce((a, b) => (dist(b, e) < dist(a, e) ? b : a));
      }
      const base = e.kind === "goblin" ? 30 : e.kind === "skeleton" ? 21 : 16;
      if (e.state === "flee") {
        this.stepToward(e, e.fleeTo, base * 2.4 * dt);
        e.walkT += dt * 2;
        if (dist(e, e.fleeTo) < 2) continue;
        keep.push(e);
        continue;
      }
      const waiting = h!.a.status === "waiting";
      if (waiting) e.angle += dt * 0.9;
      const reach = (e.kind === "boss" ? 24 : 15) + (waiting ? 12 : 0);
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
          e.lungeT = 0.2;
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
      const to = { x: s.target.x, y: s.target.y - 7 };
      const d = dist(s, to);
      const step = 190 * dt;
      if (d <= step + 2) {
        this.hit(s.from, s.target, s.act);
        continue;
      }
      s.x += ((to.x - s.x) / d) * step;
      s.y += ((to.y - s.y) / d) * step;
      if (!s.arrow) this.spark(s.x, s.y, "#ff9d3c", 1, 10);
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
    const y = e.y - 7;
    switch (act) {
      case "edit":
        this.spark(x, y, "#ffd23c", 7, 60);
        break;
      case "command":
        this.rings.push({ x, y: e.y, life: 0.35, max: 0.35, r: 20, color: "#ff9d3c" });
        this.spark(x, y, "#ff9d3c", 6, 70);
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
      this.poof(e.x, e.y - 6, e.kind === "skeleton" ? "#e6e0cc" : "#8fd05a", 10);
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

  private slash(x: number, y: number, dir: number): void {
    for (let i = 0; i < 6; i++) {
      const a = -1 + i * 0.4;
      const life = 0.12 + i * 0.012;
      this.particles.push({ x: x + Math.cos(a) * 6 * dir, y: y + Math.sin(a) * 7, vx: dir * 12, vy: 0, life, max: life, color: "#f4efe6", size: 1, grav: 0 });
    }
  }

  // ------------------------------------------------------------------ draw

  draw(g: CanvasRenderingContext2D): void {
    type Item = { y: number; hero?: Hero; enemy?: Enemy };
    const items: Item[] = [];
    for (const h of this.heroes.values()) items.push({ y: h.y, hero: h });
    for (const e of this.enemies) items.push({ y: e.y, enemy: e });
    items.sort((a, b) => a.y - b.y);

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

    for (const it of items) {
      if (it.hero) this.drawHero(g, it.hero);
      else this.drawEnemy(g, it.enemy!);
    }

    for (const s of this.shots) {
      if (s.arrow) {
        const to = s.target;
        const d = Math.hypot(to.x - s.x, to.y - 7 - s.y) || 1;
        const ux = (to.x - s.x) / d;
        const uy = (to.y - 7 - s.y) / d;
        for (let i = 0; i < 5; i++) {
          g.fillStyle = i === 4 ? "#dfe5ee" : "#8a5a34";
          g.fillRect(Math.round(s.x - ux * (4 - i)), Math.round(s.y - uy * (4 - i)), 1, 1);
        }
      } else {
        g.fillStyle = "#ffd23c";
        g.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3);
        g.fillStyle = "#fff6d0";
        g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      }
    }

    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;

    for (const h of this.heroes.values()) this.drawLabel(g, h);
  }

  private drawChar(
    g: CanvasRenderingContext2D,
    spr: CharSprites,
    x: number,
    y: number,
    facing: 1 | -1,
    frame: number,
    flash: boolean,
    striking: boolean,
    shadowW: number,
  ): void {
    const di = facing > 0 ? 0 : 1;
    const sx = Math.round(x - spr.w / 2);
    const sy = Math.round(y - spr.h + 1) - (frame ? 1 : 0);
    g.fillStyle = "rgba(15,20,15,0.3)";
    g.fillRect(Math.round(x - shadowW / 2), Math.round(y), shadowW, 2);
    g.drawImage(flash ? spr.flash[di] : spr.walk[frame][di], sx, sy);
    const k = spr.w / 16;
    const wpn = striking ? spr.weapon.strike[di] : spr.weapon.rest[di];
    const wx = striking ? (facing > 0 ? x + 3 * k : x - 3 * k - wpn.width) : facing > 0 ? x + 4 * k : x - 4 * k - wpn.width;
    const wy = striking ? y - 7 * k : y - 4 * k - wpn.height + 1;
    g.drawImage(wpn, Math.round(wx), Math.round(wy) - (frame ? 1 : 0));
  }

  private drawHero(g: CanvasRenderingContext2D, h: Hero): void {
    const frame = h.moving ? Math.floor(h.walkT * 8) % 2 : Math.sin(this.t * 2 + h.x) > 0.7 ? 1 : 0;
    if (h.a.status === "stale") g.globalAlpha = 0.45;
    if (this.selected === h.id) {
      g.fillStyle = "#ffe9a8";
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + this.t * 2;
        g.fillRect(Math.round(h.x + Math.cos(a) * 9), Math.round(h.y + Math.sin(a) * 4), 1, 1);
      }
    }
    this.drawChar(g, h.spr, h.x, h.y, h.facing, frame, false, h.strikeT > 0, 10);
    g.globalAlpha = 1;
    if (h.wispT > 0) {
      const a = this.t * 3;
      g.drawImage(this.wisp, Math.round(h.x + Math.cos(a) * 11) - 2, Math.round(h.y - 12 + Math.sin(a) * 4));
    }
  }

  private drawEnemy(g: CanvasRenderingContext2D, e: Enemy): void {
    const moving = e.state !== "fight";
    const frame = moving ? Math.floor(e.walkT * 7) % 2 : 0;
    const lunge = e.lungeT > 0 ? e.facing * 3 : 0;
    if (e.life < 0.4) g.globalAlpha = e.life / 0.4;
    this.drawChar(g, e.spr, e.x + lunge, e.y, e.facing, frame, e.flashT > 0, e.lungeT > 0, e.kind === "boss" ? 20 : 10);
    g.globalAlpha = 1;
  }

  private drawLabel(g: CanvasRenderingContext2D, h: Hero): void {
    const top = Math.round(h.y - h.spr.h - 7);
    const name = (h.a.name || h.a.project || h.a.pc).slice(0, 20);
    drawText(g, name, h.x, top, LABEL[h.a.status]);
    if (h.a.status === "waiting") {
      const bob = Math.sin(this.t * 5) > 0 ? 1 : 0;
      g.drawImage(this.bubble, Math.round(h.x - 3), top - 12 - bob);
    }
  }

  pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = 14;
    for (const h of this.heroes.values()) {
      const d = Math.hypot(h.x - x, h.y - 8 - y);
      if (d < bd) {
        bd = d;
        best = h.id;
      }
    }
    return best;
  }
}
