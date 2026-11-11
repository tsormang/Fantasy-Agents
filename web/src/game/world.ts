// Scene layout: a village island and a battlefield joined by a land bridge, built from Tiny Swords
// terrain tiles. The land is painted once per resize; water, foam and props animate every frame.
import { type Strip, U, drawStrip, img, loaded, strip } from "./art";
import { type Sprite, canvas, rng } from "./pix";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect extends Pt {
  w: number;
  h: number;
}
export interface Glow extends Pt {
  r: number;
  color: string;
  /** shown in daylight too (fires, portal) */
  always: boolean;
}
/** Something standing on the ground at (x, y); drawn in y order together with the characters. */
export interface Prop extends Pt {
  draw(g: CanvasRenderingContext2D, t: number): void;
}
export interface Layout {
  W: number;
  H: number;
  /** y of the middle of the channel separating village from battlefield */
  vh: number;
  gate: Pt;
  /** the two ends of the bridge */
  gateIn: Pt;
  gateOut: Pt;
  plaza: Rect;
  field: Rect;
  portal: Pt;
  spawns: Pt[];
  glows: Glow[];
  chimneys: Pt[];
  props: Prop[];
  /** animated things sitting in the water, drawn under everything else */
  afloat: Prop[];
  /** top-left corners of the shore tiles that get animated foam */
  foam: Pt[];
  grid: { ox: number; cb: number; cL: number; cR: number; R: number };
}

/** Tile size in world units. */
export const T = 64 / U;
export const WATER = "#47aba9";

const FOAM = strip("foam", 192, 0, 0);

interface Building {
  name: string;
  /** image size and the row of its base, in art pixels */
  w: number;
  h: number;
  base: number;
  /** footprint width in world units */
  span: number;
}
const B: Record<string, Building> = {
  castle: { name: "castle", w: 320, h: 256, base: 249, span: 78 },
  monastery: { name: "monastery", w: 192, h: 320, base: 310, span: 40 },
  barracks: { name: "barracks", w: 192, h: 256, base: 245, span: 46 },
  archery: { name: "archery", w: 192, h: 256, base: 240, span: 46 },
  tower: { name: "tower", w: 128, h: 256, base: 230, span: 30 },
  house1: { name: "house1", w: 128, h: 192, base: 173, span: 28 },
  house2: { name: "house2", w: 128, h: 192, base: 178, span: 32 },
  house3: { name: "house3", w: 128, h: 192, base: 172, span: 30 },
  enemy_tower: { name: "enemy_tower", w: 128, h: 256, base: 230, span: 30 },
  enemy_house: { name: "enemy_house", w: 128, h: 192, base: 173, span: 28 },
};

const TREES: Strip[] = [strip("tree1", 192, 96, 241), strip("tree2", 192, 96, 249), strip("tree3", 192, 96, 170), strip("tree4", 192, 96, 168)];
const BUSHES: Strip[] = [strip("bush1", 128, 64, 79), strip("bush2", 128, 64, 84)];
const ROCKS: Strip[] = [1, 2, 3, 4].map((n) => strip(`rock${n}`, 64, 32, 46));
const GOLD = strip("gold", 128, 64, 88);
const WOOD = strip("wood", 64, 32, 44);
const FIRE = strip("fire", 64, 32, 62);
const SHEEP_IDLE = strip("sheep_idle", 128, 64, 84);
const SHEEP_GRASS = strip("sheep_grass", 128, 64, 84);
const WROCKS: Strip[] = [strip("wrock1", 64, 32, 40), strip("wrock2", 64, 32, 40)];
const DUCK = strip("duck", 32, 16, 20);

const still = (s: Strip, x: number, y: number, flip = false): Prop => ({ x, y, draw: (g) => drawStrip(g, s, 0, x, y, { flip }) });
const anim = (s: Strip, x: number, y: number, phase: number, fps = 10): Prop => ({
  x,
  y,
  draw: (g, t) => drawStrip(g, s, t * fps + phase, x, y),
});

function building(b: Building, x: number, y: number): Prop {
  return {
    x,
    y,
    draw(g) {
      const i = img(b.name);
      if (loaded(i)) g.drawImage(i, x - b.w / 2 / U, y - b.base / U, b.w / U, b.h / U);
    },
  };
}

function campfire(L: Layout, x: number, y: number): void {
  L.props.push(still(WOOD, x, y), anim(FIRE, x, y - 1.5, x));
  L.glows.push({ x, y: y - 6, r: 22, color: "255,150,60", always: true });
}

function sheep(x: number, y: number, flip: boolean, phase: number): Prop {
  return {
    x,
    y,
    draw(g, t) {
      // graze for a while, then look around
      const c = (t + phase) % 6;
      if (c < 2.4) drawStrip(g, SHEEP_GRASS, c * 10, x, y, { flip });
      else drawStrip(g, SHEEP_IDLE, c * 10, x, y, { flip });
    },
  };
}

/** The swirl in the castle doorway that heroes arrive through. */
function portalSwirl(p: Pt): Prop {
  return {
    x: p.x,
    y: p.y + 0.5,
    draw(g, t) {
      for (let i = 0; i < 16; i++) {
        const a = t * 2.2 + i * 0.9;
        const rad = 1 + (i % 6) * 0.8;
        g.fillStyle = i % 3 === 0 ? "#f0d8ff" : i % 3 === 1 ? "#b46cff" : "#7a3fb8";
        g.fillRect(p.x + Math.cos(a) * rad - 0.5, p.y - 5 + Math.sin(a) * rad * 1.1, 1, 1);
      }
    },
  };
}

export function makeLayout(W: number, H: number): Layout {
  const r = rng(W * 7919 + H);
  const pick = <V>(a: V[]): V => a[(r() * a.length) | 0];
  const gx = Math.round(W / 2);

  // Tile grid: columns are shifted so the bridge (two tiles wide) is centred on the gate.
  const cb = Math.ceil(gx / T);
  const ox = gx - cb * T;
  const cL = Math.ceil((6 - ox) / T);
  const cR = Math.floor((W - 6 - ox) / T) - 1;
  // R is the tile row holding the village's southern shore.
  const R = H >= 250 ? 6 : H >= 200 ? 5 : 4;
  const shore = R * T;
  const vh = shore + T * 1.5;
  const by = shore - 40;
  const left = ox + cL * T + 4;
  const right = ox + (cR + 1) * T - 4;

  const L: Layout = {
    W,
    H,
    vh,
    gate: { x: gx, y: vh },
    gateIn: { x: gx, y: vh - 18 },
    gateOut: { x: gx, y: vh + 18 },
    plaza: { x: left + 8, y: by + 9, w: Math.max(10, right - left - 16), h: shore + 3 - (by + 9) },
    field: { x: 36, y: vh + 28, w: W - 72, h: Math.max(30, H - vh - 60) },
    portal: { x: gx, y: by - 1 },
    spawns: [
      { x: 24, y: H - 2 }, // black tower
      { x: W - 26, y: H - 2 }, // raider camp
      { x: -12, y: vh + (H - vh) * 0.5 },
      { x: W + 12, y: vh + (H - vh) * 0.6 },
      { x: gx, y: H + 14 },
    ],
    glows: [],
    chimneys: [],
    props: [],
    afloat: [],
    foam: [],
    grid: { ox, cb, cL, cR, R },
  };

  // ---- shore tiles that foam
  const tile = (c: number, row: number): Pt => ({ x: ox + c * T, y: row * T });
  for (let c = cL; c <= cR; c++) if (c !== cb - 1 && c !== cb) L.foam.push(tile(c, R));
  for (let row = 0; row < R; row++) L.foam.push(tile(cL, row), tile(cR, row));
  L.foam.push(tile(cb - 1, R + 1), tile(cb, R + 1));
  for (let c = -1; ox + c * T < W; c++) if (c !== cb - 1 && c !== cb) L.foam.push(tile(c, R + 2));

  // ---- village: the castle in the middle, guild halls and houses either side
  L.props.push(building(B.castle, gx, by), portalSwirl(L.portal));
  L.glows.push({ x: gx, y: by - 7, r: 24, color: "170,90,255", always: true });
  const spans: [number, number][] = [[gx - 42, gx + 42]];
  const sides = [
    [B.monastery, B.archery, B.house1, B.house3],
    [B.barracks, B.house2, B.house3, B.house1],
  ];
  sides.forEach((list, side) => {
    const dir = side ? 1 : -1;
    let d = 43;
    for (const b of list) {
      const cx = gx + dir * (d + b.span / 2);
      if (cx - b.span / 2 < left + 2 || cx + b.span / 2 > right - 2) break;
      const y = by + ((r() * 3) | 0);
      L.props.push(building(b, cx, y));
      L.glows.push({ x: cx, y: y - 9, r: 16, color: "255,200,90", always: false });
      if (b.name.startsWith("house")) L.chimneys.push({ x: cx + 4, y: y - 34 });
      spans.push([cx - b.span / 2, cx + b.span / 2]);
      d += b.span + 5;
    }
  });

  // gate towers either side of the bridge
  for (const dir of [-1, 1]) {
    const x = gx + dir * 31;
    L.props.push(building(B.tower, x, shore + 10));
    L.glows.push({ x, y: shore - 8, r: 16, color: "255,200,90", always: false });
  }
  // shrubs soften the far ends of the bridge
  for (const dir of [-1, 1]) L.props.push(anim(pick(BUSHES), gx + dir * 22, vh + 17, r() * 8));

  if (L.plaza.w > 150) campfire(L, gx + 58, shore - 9);
  if (L.plaza.w > 110) {
    L.props.push(sheep(left + 12, by + 16, false, 0), sheep(right - 14, by + 22, true, 3));
    if (L.plaza.w > 260) L.props.push(sheep(left + 30, by + 26, true, 1.5));
  }

  // ---- enemy camp in the bottom corners
  L.props.push(building(B.enemy_tower, 24, H - 5), building(B.enemy_house, W - 26, H - 5));
  L.glows.push({ x: 24, y: H - 16, r: 16, color: "255,90,90", always: true });
  campfire(L, W - 54, H - 9);

  // ---- trees: behind the village, down both flanks and along the bottom
  const tree = (x: number, y: number, small = false) => {
    const s = small ? TREES[2 + ((r() * 2) | 0)] : pick(TREES);
    L.props.push(anim(s, x, y, r() * 8));
  };
  for (let x = left + 10; x < right - 6; x += 20 + r() * 10) {
    if (spans.some(([a, b]) => x > a - 9 && x < b + 9)) continue;
    tree(x, by - 3 - r() * 6);
  }
  for (let y = vh + 34; y < H - 44; y += 20 + r() * 10) {
    tree(6 + r() * 10, y);
    tree(W - 6 - r() * 10, y + 7);
  }
  for (let x = 58; x < W - 76; x += 24 + r() * 12) {
    if (Math.abs(x - gx) < 26) continue;
    tree(x, H + 5 + r() * 6, true);
  }

  // ---- scattered rocks, shrubs and gold around the edge of the battlefield
  const f = L.field;
  for (let i = 0; i < Math.max(5, (f.w * f.h) / 2600); i++) {
    const a = r() * Math.PI * 2;
    const d = 0.72 + r() * 0.4;
    const x = f.x + f.w / 2 + Math.cos(a) * (f.w / 2) * d;
    const y = f.y + f.h / 2 + Math.sin(a) * (f.h / 2) * d;
    if (y < vh + 24 || Math.abs(x - gx) < 24 || x < 22 || x > W - 22) continue;
    const roll = r();
    if (roll < 0.45) L.props.push(still(pick(ROCKS), x, y, r() < 0.5));
    else if (roll < 0.9) L.props.push(anim(pick(BUSHES), x, y, r() * 8));
    else L.props.push(still(GOLD, x, y));
  }

  // ---- rocks and a duck in the channel
  for (let x = left + 14; x < right - 10; x += 46 + r() * 50) {
    if (Math.abs(x - gx) < 60) continue;
    L.afloat.push(anim(pick(WROCKS), x, vh + (r() - 0.5) * 4, r() * 16));
  }
  if (right - gx > 90) {
    const dx = gx + 44;
    const dy = vh + 1;
    L.afloat.push({ x: dx, y: dy, draw: (g, t) => drawStrip(g, DUCK, t * 4, dx + Math.sin(t * 0.5) * 3, dy) });
  }
  return L;
}

/** Paint the static land (transparent where there is water) at art resolution. */
export function paintLand(L: Layout): Sprite {
  const [cv, g] = canvas(L.W * U, L.H * U);
  const tiles = img("tiles");
  if (!loaded(tiles)) return cv;
  const { ox, cb, cL, cR, R } = L.grid;

  // Which cell of the flat-ground nine-patch (top-left 3x3 of the tilemap) goes where.
  const cell = (c: number, row: number): [number, number] | null => {
    const bridge = c === cb - 1 || c === cb;
    if (row <= R) {
      if (c < cL || c > cR) return null;
      if (row === R && bridge) return [1, 1];
      return [c === cL ? 0 : c === cR ? 2 : 1, row === R ? 2 : 1];
    }
    if (row === R + 1) return c === cb - 1 ? [0, 1] : c === cb ? [2, 1] : null;
    if (row === R + 2) return bridge ? [1, 1] : [1, 0];
    return [1, 1];
  };
  for (let row = 0; row * T < L.H; row++) {
    for (let c = -1; ox + c * T < L.W; c++) {
      const t = cell(c, row);
      if (t) g.drawImage(tiles, t[0] * 64, t[1] * 64, 64, 64, (ox + c * T) * U, row * 64, 64, 64);
    }
  }
  return cv;
}

export function drawFoam(g: CanvasRenderingContext2D, L: Layout, t: number): void {
  // the foam frame is three tiles square, centred on its tile
  for (const p of L.foam) drawStrip(g, FOAM, t * 10, p.x - T, p.y - T);
}
