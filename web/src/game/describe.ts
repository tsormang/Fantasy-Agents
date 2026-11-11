// What an agent is doing, in the game's voice. Shared by the roster and the hero speech bubble.
import type { AgentState } from "../../../shared/protocol";

const VERB: Record<string, string> = {
  edit: "Forging code",
  command: "Casting a command",
  search: "Scouting the codebase",
  read: "Studying scrolls",
  web: "Consulting the oracle",
  subagent: "Summoning a familiar",
  think: "Plotting the next move",
};

export function describe(a: AgentState): string {
  if (a.status === "idle") return "Resting in the village";
  if (a.status === "waiting") return "Awaits your word";
  if (a.status === "stale") return "Lost in the fog";
  return VERB[a.activity ?? "think"] ?? "Fighting";
}
