import type { AgentState } from "../../shared/protocol";
import { ago, el } from "./dom";
import { describe } from "./game/describe";
import type { Store } from "./store";
import { observeSize } from "./resize";

export interface Battlefield {
  select(id: string | null): void;
  onSelect: (id: string | null) => void;
}

export interface Appearance {
  portrait(agent: AgentState): HTMLCanvasElement;
  classLabel(agent: AgentState): string;
}

const RANK: Record<string, number> = { waiting: 0, working: 1, stale: 2, idle: 3 };

export class Hud {
  private roster: HTMLElement;
  private stats: HTMLElement;
  private dot: HTMLElement;
  private selected: string | null = null;

  constructor(
    root: HTMLElement,
    private store: Store,
    private game: Battlefield,
    private appearance: Appearance,
    actions: HTMLElement[] = [],
  ) {
    this.dot = el("span", { class: "dot", title: "Connection" });
    this.stats = el("span", { class: "stats dim" });
    const toggle = el("button", { class: "quiet", textContent: "Heroes" });
    this.roster = el("div", { class: "roster box" });
    this.roster.hidden = window.innerWidth < 700;
    toggle.setAttribute("aria-expanded", String(!this.roster.hidden));
    toggle.onclick = () => {
      this.roster.hidden = !this.roster.hidden;
      toggle.setAttribute("aria-expanded", String(!this.roster.hidden));
    };
    const bar = el(
      "div",
      { class: "topbar" },
      el("div", { class: "title box" }, this.dot, el("b", { textContent: "FANTASY AGENTS" }), this.stats),
      ...actions,
      toggle,
    );
    root.append(bar, this.roster);
    // The bar wraps onto a second row on narrow screens, so the roster hangs below wherever it ends.
    const place = () => root.style.setProperty("--hud-top", `${bar.offsetTop + bar.offsetHeight}px`);
    observeSize(bar, place);
    place();
    game.onSelect = (id) => {
      this.selected = id;
      // on phones the roster would cover the hero's speech bubble, so it stays as it was
      if (id && window.innerWidth >= 700) this.roster.hidden = false;
      this.render();
    };
    store.onChange(() => this.render());
    setInterval(() => this.render(), 1000);
    this.render();
  }

  private render(): void {
    const list = [...this.store.agents.values()].sort(
      (a, b) => RANK[a.status] - RANK[b.status] || a.pc.localeCompare(b.pc) || a.since - b.since,
    );
    const fighting = list.filter((a) => a.status === "working" || a.status === "waiting").length;
    this.dot.classList.toggle("on", this.store.connected);
    this.dot.title = this.store.connected ? "Connected" : "Reconnecting";
    this.stats.textContent = this.store.denied
      ? "access revoked"
      : `${fighting} in battle / ${list.length - fighting} in village`;

    const now = this.store.now();
    const rows = list.map((a) => {
      const icon = this.appearance.portrait(a);
      const row = el(
        "button",
        { class: `hero${a.id === this.selected ? " sel" : ""}` },
        icon,
        el("span", { class: "name", textContent: `${a.project || "unknown"} @ ${a.pc}` }),
        el("span", { class: "time", textContent: ago(now - a.since) }),
        el("span", {
          class: `what ${a.status}`,
          textContent: `${this.appearance.classLabel(a)} (${a.agent}) - ${describe(a)}${a.status === "working" && a.kills ? ` - ${a.kills} slain` : ""}`,
        }),
      );
      row.title = `Owner: ${a.owner}`;
      row.onclick = () => {
        this.selected = this.selected === a.id ? null : a.id;
        this.game.select(this.selected);
        this.render();
      };
      return row;
    });
    this.roster.replaceChildren(
      ...(rows.length ? rows : [el("div", { class: "empty", textContent: "The village is quiet. Connect a PC to summon heroes." })]),
    );
  }
}
