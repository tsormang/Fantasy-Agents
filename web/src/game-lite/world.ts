// Scene layout and the static background (terrain, village, forest), painted once per resize.
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
export interface Layout {
  W: number;
  H: number;
  /** y of the palisade separating village from battlefield */
  vh: number;
  gate: Pt;
  plaza: Rect;
  field: Rect;
  portal: Pt;
  spawns: Pt[];
  glows: Glow[];
  flames: Pt[];
  chimneys: Pt[];
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function makeLayout(W: number, H: number): Layout {
  const vh = clamp(Math.round(H * 0.36), 84, 130);
  const by = Math.round(vh * 0.5);
  const gx = Math.round(W / 2);
  return {
    W,
    H,
    vh,
    gate: { x: gx, y: vh },
    plaza: { x: 12, y: by + 6, w: W - 24, h: vh - by - 20 },
    field: { x: 26, y: vh + 30, w: W - 52, h: Math.max(30, H - vh - 66) },
    portal: { x: gx, y: by - 2 },
    spawns: [
      { x: 24, y: H - 16 }, // crypt
      { x: W - 28, y: H - 14 }, // goblin camp
      { x: -10, y: vh + (H - vh) * 0.45 },
      { x: W + 10, y: vh + (H - vh) * 0.55 },
      { x: gx, y: H + 12 },
    ],
    glows: [],
    flames: [],
    chimneys: [],
  };
}

const C = {
  grass: ["#4c8a3a", "#46823a", "#559443", "#5c9c48"],
  field: ["#587f39", "#62873c", "#4d7636"],
  dirt: ["#a07c4a", "#94713f", "#ad8a56", "#8a683a"],
  cobble: ["#b89a62", "#a88a54", "#c7aa72", "#9c7f4c"],
  cobbleGap: "#7a6238",
  wood: ["#8a5a34", "#774a2a", "#9a6a40"],
  woodDark: "#4a2c18",
  stone: ["#8d93a0", "#7d8390", "#9aa0ad"],
  stoneDark: "#555a66",
  outline: "#1b1622",
  wall: "#e3cfa0",
  wallShade: "#c9b282",
  window: "#ffd66b",
  leaf: ["#2f6b33", "#3d8240", "#52994c"],
  pine: ["#1f5238", "#2b6a46", "#3a8256"],
};

export function paintWorld(L: Layout): Sprite {
  const [cv, g] = canvas(L.W, L.H);
  const r = rng(L.W * 7919 + L.H);
  const pick = <T>(a: T[]): T => a[(r() * a.length) | 0];
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const disc = (cx: number, cy: number, rad: number, col: string) => {
    for (let dy = -rad; dy <= rad; dy++) {
      const half = Math.round(Math.sqrt(rad * rad - dy * dy));
      px(cx - half, cy + dy, half * 2 + 1, 1, col);
    }
  };
  const { W, H, vh } = L;
  const gx = L.gate.x;
  const by = L.portal.y + 2;

  // ---- grass
  px(0, 0, W, H, C.grass[0]);
  px(0, vh, W, H - vh, C.field[0]);
  for (let i = 0; i < (W * H) / 9; i++) {
    const x = (r() * W) | 0;
    const y = (r() * H) | 0;
    px(x, y, r() < 0.3 ? 2 : 1, 1, y < vh ? pick(C.grass) : pick(C.field));
  }
  for (let i = 0; i < (W * H) / 260; i++) {
    const x = (r() * W) | 0;
    const y = (r() * H) | 0;
    const col = y < vh ? "#6aac52" : "#77a04a";
    px(x, y, 1, 2, col);
    px(x + 2, y, 1, 2, col);
    px(x + 1, y + 1, 1, 1, col);
  }

  // ---- battlefield: a worn dirt arena below the gate
  const ax = gx;
  const ay = L.field.y + L.field.h * 0.45;
  const arx = Math.min(L.field.w * 0.46, 150);
  const ary = Math.min(L.field.h * 0.5, 80);
  for (let dy = -ary; dy <= ary; dy++) {
    const half = arx * Math.sqrt(1 - (dy * dy) / (ary * ary));
    const jl = (r() * 5) | 0;
    const jr = (r() * 5) | 0;
    px(ax - half + jl, ay + dy, half * 2 - jl - jr, 1, C.dirt[0]);
  }
  // path from the gate to the arena
  for (let y = vh - 12; y < ay - ary + 6; y++) {
    const j = (r() * 3) | 0;
    px(gx - 10 - j, y, 20 + j + ((r() * 3) | 0), 1, C.dirt[0]);
  }
  for (let i = 0; i < arx * ary * 0.5; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    px(ax + Math.cos(a) * arx * d * 0.96, ay + Math.sin(a) * ary * d * 0.96, r() < 0.25 ? 2 : 1, 1, pick(C.dirt));
  }
  // grass creeping back into the arena, plus scattered stones and bones
  for (let i = 0; i < arx * ary * 0.03; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.55 + r() * 0.45;
    const x = ax + Math.cos(a) * arx * d;
    const y = ay + Math.sin(a) * ary * d;
    px(x, y, 2, 1, pick(C.field));
    px(x + 1, y - 1, 1, 1, "#77a04a");
  }
  for (let i = 0; i < Math.max(4, (W * H) / 9000); i++) {
    const x = L.field.x + r() * L.field.w;
    const y = L.field.y + r() * L.field.h;
    if (r() < 0.6) {
      px(x, y, 4, 3, C.stone[1]);
      px(x + 1, y - 1, 2, 1, C.stone[2]);
      px(x, y + 3, 4, 1, C.stoneDark);
    } else {
      px(x, y, 3, 1, "#e6e0cc");
      px(x + 3, y - 1, 1, 3, "#e6e0cc");
    }
  }

  // ---- village plaza (cobbles)
  const cobble = (x0: number, y0: number, w: number, h: number) => {
    px(x0, y0, w, h, C.cobbleGap);
    for (let y = 0; y < h; y += 4) {
      const off = (y / 4) % 2 ? 3 : 0;
      for (let x = -off; x < w; x += 6) {
        const sx = Math.max(0, x);
        const sw = Math.min(5, w - sx, x + 5 - sx);
        if (sw > 0) px(x0 + sx, y0 + y, sw, Math.min(3, h - y), pick(C.cobble));
      }
    }
  };
  cobble(L.plaza.x, L.plaza.y, L.plaza.w, L.plaza.h);
  cobble(gx - 11, L.plaza.y + L.plaza.h, 22, vh - 12 - (L.plaza.y + L.plaza.h));
  // ragged plaza edge
  for (let x = L.plaza.x; x < L.plaza.x + L.plaza.w; x += 2) {
    if (r() < 0.4) px(x, L.plaza.y, 2, 1, pick(C.grass));
    if (r() < 0.4 && Math.abs(x - gx) > 12) px(x, L.plaza.y + L.plaza.h - 1, 2, 1, pick(C.grass));
  }

  // ---- buildings
  const roof = (cx: number, top: number, w: number, h: number, cols: string[]) => {
    for (let i = 0; i < h; i++) {
      const half = w / 2 - (h - 1 - i) * 0.7;
      px(cx - half - 1, top + i, half * 2 + 2, 1, C.outline);
      px(cx - half, top + i, half * 2, 1, i % 3 === 2 ? cols[1] : cols[0]);
      if (i % 3 !== 2) for (let x = cx - half + ((i * 3) % 5); x < cx + half - 1; x += 5) px(x, top + i, 1, 1, cols[1]);
    }
    px(cx - w / 2 - 1, top + h, w + 2, 1, C.outline);
  };
  const windowAt = (x: number, y: number) => {
    px(x - 1, y - 1, 7, 7, C.woodDark);
    px(x, y, 5, 5, C.window);
    px(x + 2, y, 1, 5, C.woodDark);
    px(x, y + 2, 5, 1, C.woodDark);
    L.glows.push({ x: x + 2, y: y + 2, r: 9, color: "255,200,90", always: false });
  };
  const door = (x: number, y: number) => {
    px(x - 4, y - 10, 8, 10, C.woodDark);
    px(x - 3, y - 9, 6, 9, C.wood[1]);
    px(x + 1, y - 5, 1, 1, "#f2c14e");
    cobble(x - 4, y, 8, L.plaza.y - y);
  };
  const house = (cx: number, w: number, kind: "cottage" | "tavern" | "forge") => {
    const wallH = 15;
    const roofH = Math.min(15, by - wallH - 4);
    const x0 = cx - w / 2 + 2;
    const stone = kind === "forge";
    px(x0 - 1, by - wallH, w - 2, wallH + 1, C.outline);
    px(x0, by - wallH, w - 4, wallH, stone ? C.stone[0] : C.wall);
    if (stone) {
      for (let y = by - wallH; y < by; y += 4)
        for (let x = x0 + (((y - by) / 4) % 2 ? 3 : 0); x < x0 + w - 4; x += 7) px(x, y, 1, 4, C.stoneDark);
      for (let y = by - wallH + 3; y < by; y += 4) px(x0, y, w - 4, 1, C.stoneDark);
    } else {
      px(x0, by - 3, w - 4, 3, C.wallShade);
      for (const bx of [x0, x0 + w - 6, cx - 7, cx + 5]) px(bx, by - wallH, 2, wallH, C.wood[1]);
      px(x0, by - wallH, w - 4, 2, C.wood[1]);
    }
    const cols =
      kind === "cottage" ? ["#b5482f", "#8a3322"] : kind === "tavern" ? ["#5a6f9c", "#42537a"] : ["#4d4a55", "#38353f"];
    // chimney behind the roof
    const chx = cx + w / 4;
    px(chx - 1, by - wallH - roofH - 3, 6, 8, C.outline);
    px(chx, by - wallH - roofH - 2, 4, 7, C.stone[1]);
    L.chimneys.push({ x: chx + 2, y: by - wallH - roofH - 4 });
    roof(cx, by - wallH - roofH, w + 2, roofH, cols);
    if (kind === "forge") {
      // open hearth instead of a door
      px(cx - 6, by - 11, 12, 11, C.outline);
      px(cx - 5, by - 10, 10, 10, "#2a1a14");
      px(cx - 4, by - 4, 8, 4, "#ff9d3c");
      px(cx - 2, by - 6, 4, 2, "#ffd23c");
      L.glows.push({ x: cx, y: by - 4, r: 16, color: "255,140,50", always: true });
      L.flames.push({ x: cx, y: by - 5 });
      cobble(cx - 5, by, 10, L.plaza.y - by);
      // anvil
      px(cx + 10, by + 1, 7, 2, C.stoneDark);
      px(cx + 12, by + 3, 3, 3, C.stoneDark);
    } else {
      door(cx, by);
      windowAt(cx - w / 2 + 6, by - 11);
      if (w > 36) windowAt(cx + w / 2 - 12, by - 11);
      if (kind === "tavern") {
        // hanging sign
        px(cx + 6, by - 13, 1, 4, C.woodDark);
        px(cx + 4, by - 9, 6, 5, C.wood[0]);
        px(cx + 6, by - 8, 2, 3, "#f2c14e");
      }
    }
  };
  const keep = (cx: number) => {
    const w = 44;
    const top = 5;
    px(cx - w / 2 - 1, top - 1, w + 2, by - top + 2, C.outline);
    px(cx - w / 2, top, w, by - top, C.stone[0]);
    for (let y = top; y < by; y += 5) {
      px(cx - w / 2, y + 4, w, 1, C.stoneDark);
      for (let x = cx - w / 2 + (((y - top) / 5) % 2 ? 4 : 0); x < cx + w / 2; x += 9) px(x, y, 1, 4, C.stoneDark);
      for (let x = cx - w / 2 + 2; x < cx + w / 2 - 2; x += 5) if (r() < 0.25) px(x, y + 1, 3, 2, pick(C.stone));
    }
    px(cx - w / 2, top, 3, by - top, C.stone[2]);
    px(cx + w / 2 - 4, top, 4, by - top, C.stone[1]);
    // crenellations
    for (let x = cx - w / 2 - 1; x < cx + w / 2; x += 9) {
      px(x, top - 5, 6, 5, C.outline);
      px(x + 1, top - 4, 4, 4, C.stone[2]);
    }
    // arched portal doorway
    const dh = Math.min(22, by - top - 6);
    for (let i = 0; i < dh; i++) {
      const half = i < 5 ? 4 + i : 9;
      px(cx - half - 1, by - dh + i, half * 2 + 2, 1, C.outline);
      px(cx - half, by - dh + i, half * 2, 1, "#2a1440");
    }
    // slit windows and banners
    for (const sx of [-15, 13]) {
      px(cx + sx, top + 6, 2, 6, C.outline);
      px(cx + sx - 2, top + 16, 6, 9, "#7a3fb8");
      px(cx + sx - 2, top + 25, 2, 2, "#7a3fb8");
      px(cx + sx + 2, top + 25, 2, 2, "#7a3fb8");
      px(cx + sx, top + 19, 2, 2, "#f2c14e");
    }
    L.glows.push({ x: cx, y: by - 8, r: 22, color: "170,90,255", always: true });
    cobble(cx - 9, by, 18, L.plaza.y - by);
  };

  keep(gx);
  const spans: [number, number][] = [[gx - 26, gx + 26]];
  const perSide = clamp(Math.floor((W / 2 - 30) / 48), 0, 3);
  const kinds: ("cottage" | "tavern" | "forge")[][] = [
    ["tavern", "cottage", "cottage"],
    ["forge", "cottage", "cottage"],
  ];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < perSide; i++) {
      const kind = kinds[side][i];
      const w = kind === "tavern" ? 42 : 36;
      const cx = gx + (side ? 1 : -1) * (52 + i * 48);
      house(cx, w, kind);
      spans.push([cx - w / 2 - 4, cx + w / 2 + 4]);
    }
  }

  // ---- palisade with a gate
  for (let x = 0; x < W; x += 4) {
    if (Math.abs(x + 2 - gx) < 14) continue;
    const top = vh - 10 + ((x / 4) % 2);
    px(x, top, 4, vh - top + 2, C.woodDark);
    px(x, top + 1, 3, vh - top, (x / 4) % 3 ? C.wood[0] : C.wood[2]);
    px(x + 1, top, 1, 1, C.wood[2]);
  }
  px(0, vh + 2, gx - 14, 1, "#3c6a2e");
  px(gx + 14, vh + 2, W - gx - 14, 1, "#3c6a2e");
  for (const sx of [-16, 12]) {
    px(gx + sx - 1, vh - 18, 6, 21, C.outline);
    px(gx + sx, vh - 17, 4, 19, C.wood[1]);
    px(gx + sx, vh - 17, 1, 19, C.wood[2]);
    px(gx + sx + 1, vh - 21, 2, 4, C.woodDark);
    L.flames.push({ x: gx + sx + 2, y: vh - 22 });
    L.glows.push({ x: gx + sx + 2, y: vh - 22, r: 14, color: "255,170,70", always: true });
  }

  // ---- lamp posts and props in the plaza
  const lamp = (x: number, y: number) => {
    px(x - 1, y - 12, 3, 13, C.outline);
    px(x, y - 11, 1, 11, C.stoneDark);
    px(x - 2, y - 15, 5, 5, C.outline);
    px(x - 1, y - 14, 3, 3, C.window);
    px(x - 2, y, 5, 1, C.outline);
    L.glows.push({ x, y: y - 13, r: 18, color: "255,205,110", always: false });
  };
  const py = L.plaza.y + L.plaza.h;
  for (const f of [0.14, 0.36, 0.64, 0.86]) {
    const x = Math.round(L.plaza.x + L.plaza.w * f);
    if (Math.abs(x - gx) > 16) lamp(x, py - 2);
  }
  const barrel = (x: number, y: number) => {
    px(x - 1, y - 1, 8, 9, C.outline);
    px(x, y, 6, 7, C.wood[0]);
    px(x, y + 1, 6, 1, C.stoneDark);
    px(x, y + 5, 6, 1, C.stoneDark);
    px(x + 1, y, 1, 7, C.wood[2]);
  };
  const crate = (x: number, y: number) => {
    px(x - 1, y - 1, 9, 9, C.outline);
    px(x, y, 7, 7, C.wood[2]);
    px(x, y, 7, 1, C.wood[0]);
    px(x, y + 6, 7, 1, C.wood[0]);
    px(x + 3, y, 1, 7, C.wood[0]);
  };
  for (const [a] of spans.slice(1)) {
    if (r() < 0.7) barrel(a + 1, by + 1);
    else crate(a + 1, by + 1);
  }

  // ---- crypt (bottom left) and goblin camp (bottom right)
  const cx0 = 24;
  const cy0 = H - 18;
  px(cx0 - 13, cy0 - 17, 26, 19, C.outline);
  px(cx0 - 12, cy0 - 16, 24, 17, C.stone[1]);
  for (let y = cy0 - 16; y < cy0; y += 4) px(cx0 - 12, y + 3, 24, 1, C.stoneDark);
  px(cx0 - 6, cy0 - 11, 12, 12, C.outline);
  px(cx0 - 5, cy0 - 10, 10, 11, "#0f1a14");
  px(cx0 - 14, cy0 - 19, 28, 3, C.stone[2]);
  px(cx0 - 2, cy0 - 15, 4, 3, "#e6e0cc");
  px(cx0 - 1, cy0 - 14, 1, 1, C.outline);
  px(cx0 + 1, cy0 - 14, 1, 1, C.outline);
  L.glows.push({ x: cx0, y: cy0 - 5, r: 14, color: "90,255,150", always: true });

  const tx = W - 28;
  const ty = H - 12;
  for (let i = 0; i < 14; i++) {
    px(tx - i - 1, ty - 14 + i, i * 2 + 2, 1, C.outline);
    px(tx - i, ty - 14 + i, i * 2, 1, i % 4 === 3 ? "#7a3a2a" : "#9c5238");
  }
  px(tx - 2, ty - 6, 4, 6, "#2a1a14");
  px(tx - 1, ty - 19, 1, 6, C.woodDark);
  px(tx, ty - 19, 4, 3, "#e0483c");
  const fx = tx - 22;
  px(fx - 3, ty - 1, 7, 2, C.woodDark);
  px(fx - 4, ty, 2, 2, C.stone[1]);
  px(fx + 3, ty, 2, 2, C.stone[1]);
  L.flames.push({ x: fx, y: ty - 2 });
  L.glows.push({ x: fx, y: ty - 3, r: 18, color: "255,150,60", always: true });

  // ---- trees
  const trees: { x: number; y: number; pine: boolean }[] = [];
  for (let y = vh + 14; y < H + 6; y += 11 + r() * 6) {
    for (const side of [0, 1]) {
      const x = side ? W - 4 - r() * 14 : 4 + r() * 14;
      if (y > H - 44 && ((side === 0 && x < 44) || (side === 1 && x > W - 62))) continue;
      trees.push({ x, y, pine: r() < 0.55 });
    }
  }
  for (let x = 48; x < W - 64; x += 13 + r() * 8) {
    if (Math.abs(x - gx) < 22) continue;
    trees.push({ x, y: H - 2 + r() * 6, pine: r() < 0.6 });
  }
  for (let x = 8; x < W - 4; x += 15 + r() * 6) {
    if (spans.some(([a, b]) => x > a - 8 && x < b + 8)) continue;
    trees.push({ x, y: by - 2 - r() * 6, pine: r() < 0.4 });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const t of trees) {
    const x = Math.round(t.x);
    const y = Math.round(t.y);
    px(x - 5, y - 1, 11, 3, "rgba(20,30,20,0.35)");
    px(x - 2, y - 6, 4, 7, C.outline);
    px(x - 1, y - 6, 2, 6, C.wood[1]);
    if (t.pine) {
      for (let tier = 0; tier < 3; tier++) {
        const baseY = y - 5 - tier * 6;
        const bw = 9 - tier * 2;
        for (let i = 0; i < 8; i++) {
          const half = Math.max(0, bw - i * (bw / 8) - 0.5);
          px(x - half - 1, baseY - i, half * 2 + 2, 1, C.outline);
          px(x - half, baseY - i, half * 2, 1, C.pine[1]);
          px(x - half, baseY - i, Math.max(1, half * 0.7), 1, C.pine[2]);
          if (i === 0) px(x - half, baseY, half * 2, 1, C.pine[0]);
        }
      }
    } else {
      disc(x, y - 13, 9, C.outline);
      disc(x, y - 13, 8, C.leaf[0]);
      disc(x - 1, y - 14, 6, C.leaf[1]);
      disc(x - 3, y - 16, 3, C.leaf[2]);
      for (let i = 0; i < 6; i++) px(x - 6 + r() * 12, y - 18 + r() * 10, 1, 1, pick(C.leaf));
    }
  }

  // flowers
  for (let i = 0; i < (W * H) / 1400; i++) {
    const x = (r() * W) | 0;
    const y = (r() * H) | 0;
    const d = g.getImageData(clamp(x, 0, W - 1), clamp(y, 0, H - 1), 1, 1).data;
    if (d[1] > d[0] && d[1] > d[2] && d[1] > 110) px(x, y, 1, 1, pick(["#ffd23c", "#f4efe6", "#e0483c", "#b46cff"]));
  }

  return cv;
}
