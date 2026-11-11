// Pixel helpers: bake palette-indexed grids into canvases (overlay marks), a 3x5 bitmap font, seeded RNG.

export type Sprite = HTMLCanvasElement;
export type Palette = Record<string, string>;

export function canvas(w: number, h: number): [Sprite, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Each row is a string; each character indexes the palette. "." and " " are transparent. */
export function bake(rows: string[], pal: Palette, scale = 1): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  const [c, g] = canvas(w * scale, rows.length * scale);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- 3x5 font

const GLYPHS: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101111011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  "0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110",
  "4": "101101111001001", "5": "111100110001110", "6": "011100111101111", "7": "111001010010010",
  "8": "111101111101111", "9": "111101111001110",
  "-": "000000111000000", _: "000000000000111", ".": "000000000000010", ":": "000010000010000",
  "!": "010010010000010", "/": "001001010100100", "?": "110001010000010", "+": "000010111010000",
};

export const textWidth = (s: string): number => Math.max(0, s.length * 4 - 1);

const textCache = new Map<string, Sprite>();

/** Returns a cached sprite of the text with a 1px dark outline (so it reads on any terrain). */
export function textSprite(text: string, color: string, outline = "#1b1622"): Sprite {
  const key = `${color}|${outline}|${text}`;
  let s = textCache.get(key);
  if (s) return s;
  const up = text.toUpperCase();
  const [c, g] = canvas(textWidth(up) + 2, 7);
  const plot = (ox: number, oy: number, col: string) => {
    g.fillStyle = col;
    for (let i = 0; i < up.length; i++) {
      const gl = GLYPHS[up[i]];
      if (!gl) continue;
      for (let p = 0; p < 15; p++) if (gl[p] === "1") g.fillRect(ox + i * 4 + (p % 3), oy + ((p / 3) | 0), 1, 1);
    }
  };
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) plot(dx, dy, outline);
  plot(1, 1, color);
  if (textCache.size > 400) textCache.clear();
  textCache.set(key, c);
  s = c;
  return s;
}
