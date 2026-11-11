import type { Activity, AgentKind, AgentState } from "../../shared/protocol";
import type { Store } from "./store";

const CAST: [AgentKind, string, string, string][] = [
  ["claude", "Forge-PC", "George", "fantasy-agents"],
  ["claude", "Forge-PC", "George", "storefront"],
  ["codex", "Forge-PC", "George", "billing-api"],
  ["cursor", "Laptop", "George", "mobile-app"],
  ["claude", "Tower", "Maria", "data-pipeline"],
  ["codex", "Tower", "Maria", "infra"],
  ["cursor", "Studio-Mac", "Nikos", "landing-page"],
];
const ACTS: Activity[] = ["edit", "edit", "command", "search", "read", "web", "subagent", "think"];

/** Scripted fake agents so the battlefield can be seen without any connected PC. */
export function startDemo(store: Store): void {
  const now = Date.now();
  const agents: AgentState[] = CAST.map(([agent, pc, owner, project], i) => ({
    id: `demo-${i}`,
    agent,
    pc,
    pcId: `pc-${pc}`,
    owner,
    project,
    status: i % 3 === 2 ? "idle" : "working",
    activity: i % 3 === 2 ? null : "think",
    since: now - (i === 0 ? 11 * 60_000 : i * 47_000),
    last: now,
    kills: i * 3,
  }));
  store.connected = true;
  store.apply({ t: "snapshot", agents, now });

  setInterval(() => {
    const a = agents[(Math.random() * agents.length) | 0];
    const t = Date.now();
    const roll = Math.random();
    if (a.status === "idle") {
      if (roll < 0.25) Object.assign(a, { status: "working", activity: "think", since: t, kills: 0 });
      else return;
    } else if (a.status === "waiting") {
      if (roll < 0.5) a.status = "working";
      else return;
    } else if (roll < 0.05) {
      Object.assign(a, { status: "idle", activity: null, since: t });
    } else if (roll < 0.1) {
      a.status = "waiting";
    } else {
      a.activity = ACTS[(Math.random() * ACTS.length) | 0];
      a.kills += 1;
    }
    a.last = t;
    store.apply({ t: "agent", agent: { ...a }, now: t });
  }, 900);
}
