import { el } from "./dom";
import { Game } from "./game-lite/game";
import { hash } from "./game-lite/pix";
import { CLASS_LABEL, CLASS_OF, heroSprites } from "./game-lite/sprites";
import { Hud, type Appearance } from "./hud";
import type { Store } from "./store";

const appearance: Appearance = {
  classLabel: (a) => CLASS_LABEL[CLASS_OF[a.agent]],
  portrait(a) {
    const icon = el("canvas", { width: 16, height: 16 });
    icon.getContext("2d")!.drawImage(heroSprites(a.agent, hash(a.pcId) % 8).walk[0][0], 0, 0);
    return icon;
  },
};

export function loadSkins(): void {
  document.documentElement.classList.add("lite");
}

export function mount(root: HTMLElement, store: Store, actions: HTMLElement[]): void {
  new Hud(root, store, new Game(root, store), appearance, actions);
}
