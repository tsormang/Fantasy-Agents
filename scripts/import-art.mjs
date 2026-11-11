// Copies the subset of the Tiny Swords free pack that the game uses into web/src/assets/ts,
// under flat names. The pack is not part of this repository (its licence forbids redistribution):
// download it from https://pixelfrog-assets.itch.io/tiny-swords and unzip it, then run
//   npm run art -- "path/to/Tiny Swords (Free Pack)"
// With no path, the pack is looked for inside a "Tiny Swords" folder at the repository root.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The pack folder is the one that holds Units, Buildings and Terrain; zips often nest it a level or two. */
function findPack(dir, depth = 3) {
  if (!existsSync(dir)) return null;
  if (["Units", "Buildings", "Terrain"].every((d) => existsSync(join(dir, d)))) return dir;
  if (!depth) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("__") || /legacy/i.test(e.name)) continue;
    const hit = findPack(join(dir, e.name), depth - 1);
    if (hit) return hit;
  }
  return null;
}

const given = process.argv[2];
const src = findPack(given ? resolve(given) : join(root, "Tiny Swords"));
if (!src) {
  console.error(
    [
      `Could not find the Tiny Swords free pack${given ? ` in ${resolve(given)}` : ""}.`,
      "1. Download the free pack from https://pixelfrog-assets.itch.io/tiny-swords",
      "2. Unzip it",
      '3. Run: npm run art -- "path/to/Tiny Swords (Free Pack)"',
    ].join("\n"),
  );
  process.exit(1);
}
const out = join(root, "web", "src", "assets", "ts");

const files = {
  tiles: "Terrain/Tileset/Tilemap_color1.png",
  foam: "Terrain/Tileset/Water Foam.png",
  wrock1: "Terrain/Decorations/Rocks in the Water/Water Rocks_01.png",
  wrock2: "Terrain/Decorations/Rocks in the Water/Water Rocks_03.png",
  duck: "Terrain/Decorations/Rubber Duck/Rubber duck.png",
  tree1: "Terrain/Resources/Wood/Trees/Tree1.png",
  tree2: "Terrain/Resources/Wood/Trees/Tree2.png",
  tree3: "Terrain/Resources/Wood/Trees/Tree3.png",
  tree4: "Terrain/Resources/Wood/Trees/Tree4.png",
  bush1: "Terrain/Decorations/Bushes/Bushe1.png",
  bush2: "Terrain/Decorations/Bushes/Bushe3.png",
  rock1: "Terrain/Decorations/Rocks/Rock1.png",
  rock2: "Terrain/Decorations/Rocks/Rock2.png",
  rock3: "Terrain/Decorations/Rocks/Rock3.png",
  rock4: "Terrain/Decorations/Rocks/Rock4.png",
  gold: "Terrain/Resources/Gold/Gold Stones/Gold Stone 3.png",
  wood: "Terrain/Resources/Wood/Wood Resource/Wood Resource.png",
  sheep_idle: "Terrain/Resources/Meat/Sheep/Sheep_Idle.png",
  sheep_grass: "Terrain/Resources/Meat/Sheep/Sheep_Grass.png",
  fire: "Particle FX/Fire_02.png",
  dust: "Particle FX/Dust_02.png",
  boom: "Particle FX/Explosion_01.png",
  castle: "Buildings/Blue Buildings/Castle.png",
  monastery: "Buildings/Blue Buildings/Monastery.png",
  barracks: "Buildings/Blue Buildings/Barracks.png",
  archery: "Buildings/Blue Buildings/Archery.png",
  tower: "Buildings/Blue Buildings/Tower.png",
  house1: "Buildings/Blue Buildings/House1.png",
  house2: "Buildings/Blue Buildings/House2.png",
  house3: "Buildings/Blue Buildings/House3.png",
  enemy_tower: "Buildings/Black Buildings/Tower.png",
  enemy_house: "Buildings/Black Buildings/House1.png",
  black_pawn_idle: "Units/Black Units/Pawn/Pawn_Idle Axe.png",
  black_pawn_run: "Units/Black Units/Pawn/Pawn_Run Axe.png",
  black_pawn_attack: "Units/Black Units/Pawn/Pawn_Interact Axe.png",
  black_lancer_idle: "Units/Black Units/Lancer/Lancer_Idle.png",
  black_lancer_run: "Units/Black Units/Lancer/Lancer_Run.png",
  black_lancer_attack: "Units/Black Units/Lancer/Lancer_Right_Attack.png",
  black_warrior_idle: "Units/Black Units/Warrior/Warrior_Idle.png",
  black_warrior_run: "Units/Black Units/Warrior/Warrior_Run.png",
  black_warrior_attack1: "Units/Black Units/Warrior/Warrior_Attack1.png",
};

for (const [color, dir] of [["blue", "Blue"], ["red", "Red"], ["yellow", "Yellow"], ["purple", "Purple"]]) {
  const u = `Units/${dir} Units`;
  Object.assign(files, {
    [`${color}_monk_idle`]: `${u}/Monk/Idle.png`,
    [`${color}_monk_run`]: `${u}/Monk/Run.png`,
    [`${color}_monk_cast`]: `${u}/Monk/Heal.png`,
    [`${color}_warrior_idle`]: `${u}/Warrior/Warrior_Idle.png`,
    [`${color}_warrior_run`]: `${u}/Warrior/Warrior_Run.png`,
    [`${color}_warrior_attack1`]: `${u}/Warrior/Warrior_Attack1.png`,
    [`${color}_warrior_attack2`]: `${u}/Warrior/Warrior_Attack2.png`,
    [`${color}_archer_idle`]: `${u}/Archer/Archer_Idle.png`,
    [`${color}_archer_run`]: `${u}/Archer/Archer_Run.png`,
    [`${color}_archer_shoot`]: `${u}/Archer/Archer_Shoot.png`,
  });
}
files.arrow = "Units/Blue Units/Archer/Arrow.png";

// HUD skins and portraits. The avatar sheet runs colour by colour (blue, red, yellow, purple, black),
// five heads each: warrior, lancer, archer, monk, pawn.
const ui = "UI Elements/UI Elements";
Object.assign(files, {
  ui_paper: `${ui}/Papers/RegularPaper.png`,
  ui_button_blue: `${ui}/Buttons/BigBlueButton_Regular.png`,
  ui_button_red: `${ui}/Buttons/BigRedButton_Regular.png`,
  ui_button_quiet: `${ui}/Buttons/BigBlueButton_Pressed.png`,
  ui_ribbons: `${ui}/Ribbons/BigRibbons.png`,
  ui_ribbons_small: `${ui}/Ribbons/SmallRibbons.png`,
  ui_badge_red: `${ui}/Buttons/TinyRoundRedButton.png`,
});
["blue", "red", "yellow", "purple"].forEach((color, c) => {
  for (const [cls, i] of [["warrior", 1], ["archer", 3], ["monk", 4]]) {
    files[`avatar_${color}_${cls}`] = `${ui}/Human Avatars/Avatars_${String(c * 5 + i).padStart(2, "0")}.png`;
  }
});

const missing = Object.values(files).filter((rel) => !existsSync(join(src, rel)));
if (missing.length) {
  console.error(`The pack in ${src} is missing ${missing.length} expected files, for example:\n  ${missing.slice(0, 5).join("\n  ")}`);
  console.error("Make sure it is the current free pack, not the legacy edition.");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [name, rel] of Object.entries(files)) copyFileSync(join(src, rel), join(out, `${name}.png`));
console.log(`Copied ${Object.keys(files).length} images to ${out}`);
