// Each renderer is a separate chunk so lite never loads the Tiny Swords assets.
import { el } from "./dom";
import { Game } from "./game/game";
import { img, loaded } from "./game/art";
import { hash } from "./game/pix";
import { CLASS_LABEL, CLASS_OF, PC_COLORS } from "./game/sprites";
import { Hud, type Appearance } from "./hud";
import type { Store } from "./store";
export { loadSkins } from "./ui";

const appearance: Appearance = {
  classLabel: (a) => CLASS_LABEL[CLASS_OF[a.agent]],
  portrait(a) {
    const icon = el("canvas", { width: 96, height: 96 });
    const portrait = img(`avatar_${PC_COLORS[hash(a.pcId) % PC_COLORS.length]}_${CLASS_OF[a.agent]}`);
    if (loaded(portrait)) icon.getContext("2d")!.drawImage(portrait, 18, 20, 216, 216, 0, 0, 96, 96);
    return icon;
  },
};

export function mount(root: HTMLElement, store: Store, actions: HTMLElement[]): void {
  new Hud(root, store, new Game(root, store), appearance, actions);
}
