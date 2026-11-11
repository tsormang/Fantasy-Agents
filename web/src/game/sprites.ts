// Character definitions on top of the Tiny Swords unit sheets. All units face right; left is a flip.
import type { AgentKind } from "../../../shared/protocol";
import { type Strip, strip } from "./art";
import { type Palette, type Sprite, bake } from "./pix";

/** Faction colours: one per PC, so machines can be told apart at a glance. Black is the enemy. */
export const PC_COLORS = ["blue", "red", "yellow", "purple"] as const;

export type HeroClass = "monk" | "warrior" | "archer";
export const CLASS_OF: Record<AgentKind, HeroClass> = { claude: "monk", codex: "warrior", cursor: "archer" };
export const CLASS_LABEL: Record<HeroClass, string> = { monk: "Monk", warrior: "Warrior", archer: "Archer" };

export interface CharSprites {
  idle: Strip;
  run: Strip;
  /** cycled through, one per attack */
  attacks: Strip[];
  /** seconds one attack animation takes */
  attackTime: number;
  /** fraction of the attack at which the blow lands or the shot leaves */
  release: number;
  /** height of the figure in world units, for labels */
  h: number;
  scale: number;
}

// Unit sheets use 192px frames with the feet at (96, 136); the lancer uses 320px frames.
const unit = (name: string): Strip => strip(name, 192, 96, 136);
const lance = (name: string): Strip => strip(name, 320, 152, 198);

function heroSet(cls: HeroClass, color: string): CharSprites {
  const u = (n: string) => unit(`${color}_${cls}_${n}`);
  switch (cls) {
    case "monk":
      return { idle: u("idle"), run: u("run"), attacks: [u("cast")], attackTime: 0.6, release: 0.5, h: 19, scale: 1 };
    case "archer":
      return { idle: u("idle"), run: u("run"), attacks: [u("shoot")], attackTime: 0.6, release: 0.62, h: 23, scale: 1 };
    default:
      return { idle: u("idle"), run: u("run"), attacks: [u("attack1"), u("attack2")], attackTime: 0.4, release: 0.5, h: 23, scale: 1 };
  }
}

const heroCache = new Map<string, CharSprites>();

export function heroSprites(kind: AgentKind, pcColor: number): CharSprites {
  const cls = CLASS_OF[kind] ?? "warrior";
  const color = PC_COLORS[pcColor % PC_COLORS.length];
  const key = `${cls}:${color}`;
  let s = heroCache.get(key);
  if (!s) {
    s = heroSet(cls, color);
    heroCache.set(key, s);
  }
  return s;
}

/** The black faction: axe raiders, lancers, and an oversized knight as the warlord. */
export type EnemyKind = "raider" | "lancer" | "boss";

const ENEMIES: Record<EnemyKind, CharSprites> = {
  raider: {
    idle: unit("black_pawn_idle"),
    run: unit("black_pawn_run"),
    attacks: [unit("black_pawn_attack")],
    attackTime: 0.5,
    release: 0.5,
    h: 19,
    scale: 1,
  },
  lancer: {
    idle: lance("black_lancer_idle"),
    run: lance("black_lancer_run"),
    attacks: [lance("black_lancer_attack")],
    attackTime: 0.35,
    release: 0.5,
    h: 22,
    scale: 1,
  },
  boss: {
    idle: unit("black_warrior_idle"),
    run: unit("black_warrior_run"),
    attacks: [unit("black_warrior_attack1")],
    attackTime: 0.45,
    release: 0.5,
    h: 36,
    scale: 1.6,
  },
};

export const enemySprites = (kind: EnemyKind): CharSprites => ENEMIES[kind];

export const ARROW = strip("arrow", 64, 32, 32);
export const DUST = strip("dust", 64, 32, 40);
export const BOOM = strip("boom", 192, 96, 92);

// Small overlay marks, kept as chunky pixels so they read at any zoom.
const MARK: Palette = { k: "#1b1622", w: "#f4efe6", r: "#e0483c", p: "#b9f06a" };

/** Small familiar summoned for sub-agents. */
export const WISP = (): Sprite => bake([".pp.", "pwwp", "pwwp", ".pp.", "..p."], MARK);

export const BUBBLE = (): Sprite =>
  bake([".kkkkk.", "kwwwwwk", "kwwrwwk", "kwwrwwk", "kwwrwwk", "kwwwwwk", "kwwrwwk", "kwwwwwk", ".kkwkk.", "...k..."], MARK);
