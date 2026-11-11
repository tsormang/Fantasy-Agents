import type { AgentState } from "../../shared/protocol";
import { ago, el } from "./dom";
import type { Game } from "./game/game";
import { hash } from "./game/pix";
import { CLASS_LABEL, CLASS_OF, heroSprites } from "./game/sprites";
import type { Store } from "./store";

const VERB: Record<string, string> = {
  edit: "Forging code",
  command: "Casting a command",
  search: "Scouting the codebase",
  read: "Studying scrolls",
  web: "Consulting the oracle",
  subagent: "Summoning a familiar",
  think: "Plotting the next move",
};

function describe(a: AgentState): string {
  if (a.status === "idle") return "Resting in the village";
  if (a.status === "waiting") return "Awaits your word";
  if (a.status === "stale") return "Lost in the fog";
  return VERB[a.activity ?? "think"] ?? "Fighting";
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
    private game: Game,
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
    root.append(
      el(
        "div",
        { class: "topbar" },
        el("div", { class: "title box" }, this.dot, el("b", { textContent: "FANTASY AGENTS" }), this.stats),
        el("span", { class: "spacer" }),
        ...actions,
        toggle,
      ),
      this.roster,
    );
    game.onSelect = (id) => {
      this.selected = id;
      if (id) this.roster.hidden = false;
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
      const cls = CLASS_OF[a.agent] ?? "squire";
      const icon = el("canvas", { width: 16, height: 16 });
      icon.getContext("2d")!.drawImage(heroSprites(a.agent, hash(a.pcId) % 8).walk[0][0], 0, 0);
      const row = el(
        "button",
        { class: `hero${a.id === this.selected ? " sel" : ""}` },
        icon,
        el("span", { class: "name", textContent: `${a.project || "unknown"} @ ${a.pc}` }),
        el("span", { class: "time", textContent: ago(now - a.since) }),
        el("span", {
          class: `what ${a.status}`,
          textContent: `${CLASS_LABEL[cls]} (${a.agent}) - ${describe(a)}${a.status === "working" && a.kills ? ` - ${a.kills} slain` : ""}`,
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
