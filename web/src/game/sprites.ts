// Original pixel art, authored as palette-indexed grids. All characters face right.
import type { AgentKind } from "../../../shared/protocol";
import { type Palette, type Sprite, bake, flipX, rotate, silhouette } from "./pix";

const BASE: Palette = {
  k: "#1b1622", // outline
  s: "#e8b592", // skin
  w: "#f4efe6", // white
  m: "#b8c0cc", // metal
  M: "#7b8494",
  b: "#8a5a34", // wood / leather
  B: "#5e3a22",
  g: "#f2c14e", // gold
  o: "#ff9d3c", // ember
  p: "#b46cff", // arcane
  r: "#e0483c", // red
  G: "#6fae3f", // goblin skin
  D: "#3f7a2c",
  n: "#e6e0cc", // bone
  N: "#b3ab93",
  h: "#b5562a", // hair
};

/** Cloak colours: one per PC, so machines can be told apart at a glance. */
export const PC_COLORS: [string, string][] = [
  ["#3f7fd6", "#2a579c"], // blue
  ["#d6473f", "#9c2a2a"], // red
  ["#3fae6a", "#2a7a48"], // green
  ["#c9a227", "#94741a"], // gold
  ["#9a5fd6", "#6a3d9c"], // violet
  ["#2fb5b5", "#1f7f7f"], // teal
  ["#e07a3a", "#a65424"], // orange
  ["#d65fa8", "#9c3d78"], // pink
];

/** Trim colours: one per agent kind. */
const KIND_TRIM: Record<string, [string, string]> = {
  claude: ["#e8824a", "#b55c2e"],
  codex: ["#5a6272", "#3c4350"],
  cursor: ["#4c8a57", "#35633e"],
  other: ["#8d8d99", "#63636e"],
};

export type HeroClass = "mage" | "barbarian" | "ranger" | "squire";
export const CLASS_OF: Record<AgentKind, HeroClass> = { claude: "mage", codex: "barbarian", cursor: "ranger" };
export const CLASS_LABEL: Record<HeroClass, string> = { mage: "Mage", barbarian: "Barbarian", ranger: "Ranger", squire: "Squire" };

interface CharArt {
  body: string[];
  /** Replacement for the last three rows on the second walk frame. */
  legsB?: string[];
}

const MAGE: CharArt = {
  body: [
    "................",
    "......kkkk......",
    ".....kcccck.....",
    "....kccccCck....",
    "....kcsssCck....",
    "....kcsksksk....",
    "....kcsssssk....",
    ".....kkssCk.....",
    "....kccaacck....",
    "...kcccaaccck...",
    "...kcCcaacCck...",
    "...ksCcaacCsk...",
    "....kCcaacCk....",
    "....kccaacck....",
    "...kcccaaccck...",
    "...kkkkkkkkkk...",
  ],
  legsB: ["....kccaacck....", "....kcccaacck...", "....kkkkkkkkk..."],
};

const BARBARIAN: CharArt = {
  body: [
    "................",
    "...w......w.....",
    "...wkkkkkkw.....",
    "...kmmmmmmk.....",
    "...kmMmmMmk.....",
    "...kssssssk.....",
    "...ksskssksk....",
    "...khhhhhhk.....",
    "..kckhhhhkck....",
    ".kcsksssskssk...",
    ".kcsksssskssk...",
    ".kckkaaaakkk....",
    "..kckaaaak......",
    "...kkaakaak.....",
    "...kbbkkbbk.....",
    "...kkk..kkk.....",
  ],
  legsB: ["...kkaaaakk.....", "....kbbkbbk.....", "....kkkkkkk....."],
};

const RANGER: CharArt = {
  body: [
    "................",
    "......kkkk......",
    ".....kcccck.....",
    "....kccccCck....",
    "....kcsssssk....",
    "....kcsksksk....",
    "....kcsssssk....",
    ".....kksssk.....",
    "....kcaaaack....",
    "...kccaaaaCck...",
    "...kscagaaCsk...",
    "...kkcaaaaCkk...",
    "....kcaaaaCk....",
    "....kbbkkbbk....",
    "....kbbk.kbbk...",
    "....kkkk.kkkk...",
  ],
  legsB: ["....kbbkbbk.....", ".....kbbbbk.....", ".....kkkkkk....."],
};

const SQUIRE: CharArt = {
  body: [
    "................",
    "......kkkk......",
    ".....kmmmmk.....",
    "....kmmmmmMk....",
    "....kmkkkkMk....",
    "....kmsksksk....",
    "....kmmmmmMk....",
    ".....kkmmkk.....",
    "....kcccccck....",
    "...kmccgcccmk...",
    "...kmccccccmk...",
    "...kskccccksk...",
    "....kcccccck....",
    "....kMMkkMMk....",
    "....kMMk.kMMk...",
    "....kkkk.kkkk...",
  ],
  legsB: ["....kMMkMMk.....", ".....kMMMMk.....", ".....kkkkkk....."],
};

const GOBLIN: CharArt = {
  body: [
    "................",
    "................",
    "................",
    "................",
    "..k...kkkk...k..",
    ".kGk.kGGGGk.kGk.",
    ".kGGkGGGGGGkGGk.",
    "..kkGrGGGGrGkk..",
    "....kGGGGGGk....",
    "....kGkwwkGk....",
    ".....kGGGGk.....",
    "....kGbbbbGk....",
    "...kGkbbbbkGk...",
    "...kk.kDDk.kk...",
    ".....kGkkGk.....",
    ".....kkk.kkk....",
  ],
  legsB: ["...kk.kDDk.kk...", "......kGGk......", "......kkkk......"],
};

const SKELETON: CharArt = {
  body: [
    "................",
    "......kkkk......",
    ".....knnnnk.....",
    "....knnnnnnk....",
    "....knknnknk....",
    "....knnnnnnk....",
    ".....knkknk.....",
    "......knnk......",
    "....kknnnnkk....",
    "...knknNNnknk...",
    "...knknnnnknk...",
    "...knkkNNkknk...",
    "...kk.knnk.kk...",
    ".....knkknk.....",
    ".....knk.knk....",
    ".....kkk.kkk....",
  ],
  legsB: ["...kk.knnk.kk...", "......knnk......", "......kkkk......"],
};

const WEAPONS: Record<string, string[]> = {
  staff: [".o.", "ogo", ".o.", ".b.", ".b.", ".b.", ".b.", ".b.", ".b.", ".b.", ".b.", ".b."],
  axe: [".mmk.", "mmmbk", "mmmbk", ".mkbk", "..kbk", "..kbk", "..kbk", "..kbk", "..kbk", "..kkk"],
  bow: ["kb...", ".kb..", "..kb.", "..wkb", "..wkb", "..wkb", "..wkb", "..kb.", ".kb..", "kb..."],
  sword: [".m.", ".m.", ".m.", ".m.", ".m.", ".m.", "ggg", ".b.", ".b."],
  club: [".BB.", "BbbB", "BbbB", "BbbB", ".bB.", ".b..", ".b..", ".b.."],
  bone: ["n.n", ".n.", ".n.", ".n.", ".n.", ".n.", "NnN", ".N."],
};

export interface CharSprites {
  /** [right, left] x [frameA, frameB] */
  walk: [Sprite, Sprite][];
  flash: [Sprite, Sprite];
  weapon: { rest: [Sprite, Sprite]; strike: [Sprite, Sprite] };
  w: number;
  h: number;
}

function build(art: CharArt, pal: Palette, weapon: string, scale = 1): CharSprites {
  const a = bake(art.body, pal, scale);
  const rowsB = art.legsB ? [...art.body.slice(0, -art.legsB.length), ...art.legsB] : art.body;
  const b = bake(rowsB, pal, scale);
  const wr = bake(WEAPONS[weapon], pal, scale);
  const ws = rotate(wr);
  const white = silhouette(a, "#ffffff");
  return {
    walk: [
      [a, flipX(a)],
      [b, flipX(b)],
    ],
    flash: [white, flipX(white)],
    weapon: { rest: [wr, flipX(wr)], strike: [ws, flipX(ws)] },
    w: a.width,
    h: a.height,
  };
}

const HERO_ART: Record<HeroClass, [CharArt, string]> = {
  mage: [MAGE, "staff"],
  barbarian: [BARBARIAN, "axe"],
  ranger: [RANGER, "bow"],
  squire: [SQUIRE, "sword"],
};

const heroCache = new Map<string, CharSprites>();

export function heroSprites(kind: AgentKind, pcColor: number): CharSprites {
  const cls = CLASS_OF[kind] ?? "squire";
  const key = `${cls}:${kind}:${pcColor}`;
  let s = heroCache.get(key);
  if (!s) {
    const [c, C] = PC_COLORS[pcColor % PC_COLORS.length];
    const [a, A] = KIND_TRIM[kind] ?? KIND_TRIM.other;
    const [art, weapon] = HERO_ART[cls];
    s = build(art, { ...BASE, c, C, a, A }, weapon);
    heroCache.set(key, s);
  }
  return s;
}

export type EnemyKind = "goblin" | "skeleton" | "boss";
let enemyCache: Record<EnemyKind, CharSprites> | null = null;

export function enemySprites(kind: EnemyKind): CharSprites {
  if (!enemyCache) {
    enemyCache = {
      goblin: build(GOBLIN, BASE, "club"),
      skeleton: build(SKELETON, BASE, "bone"),
      // The warlord is a goblin drawn double size in a darker hide.
      boss: build(GOBLIN, { ...BASE, G: "#a3564a", D: "#6e3a34", b: "#4a4458", r: "#ffd23c" }, "club", 2),
    };
  }
  return enemyCache[kind];
}

/** Small familiar summoned for sub-agents. */
export const WISP = (): Sprite =>
  bake([".pp.", "pwwp", "pwwp", ".pp.", "..p."], BASE);

export const BUBBLE = (): Sprite =>
  bake(
    [".kkkkk.", "kwwwwwk", "kwwrwwk", "kwwrwwk", "kwwrwwk", "kwwwwwk", "kwwrwwk", "kwwwwwk", ".kkwkk.", "...k..."],
    BASE,
  );

export const ARROW = (): Sprite => bake(["bbbbm"], BASE);
