// Wire protocol shared by the Worker, the web client and (by convention) the connector.

export const AGENT_KINDS = ["claude", "codex", "cursor"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const EVENT_KINDS = ["start", "working", "activity", "waiting", "idle", "end"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const ACTIVITIES = ["edit", "command", "search", "read", "web", "subagent", "think"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export type AgentStatus = "idle" | "working" | "waiting" | "stale";

/** What a connected PC posts to /api/events. Nothing else is accepted. */
export interface AgentEvent {
  v: 1;
  agent: AgentKind;
  session: string;
  event: EventKind;
  activity?: Activity;
  project?: string;
}

/** One hero on the battlefield. */
export interface AgentState {
  id: string;
  agent: AgentKind;
  pc: string;
  pcId: string;
  owner: string;
  project: string;
  status: AgentStatus;
  activity: Activity | null;
  /** ms epoch when the current status began */
  since: number;
  /** ms epoch of the last event */
  last: number;
  /** tool calls seen during the current task */
  kills: number;
}

export type ServerMsg =
  | { t: "snapshot"; agents: AgentState[]; now: number }
  | { t: "agent"; agent: AgentState; now: number }
  | { t: "gone"; id: string };

const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";

export function parseEvent(raw: unknown): AgentEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (!AGENT_KINDS.includes(o.agent as AgentKind)) return null;
  if (!EVENT_KINDS.includes(o.event as EventKind)) return null;
  const session = clean(o.session, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) return null;
  const ev: AgentEvent = { v: 1, agent: o.agent as AgentKind, session, event: o.event as EventKind };
  if (ACTIVITIES.includes(o.activity as Activity)) ev.activity = o.activity as Activity;
  const project = clean(o.project, 40);
  if (project) ev.project = project;
  return ev;
}

export const cleanName = (s: unknown, max = 24): string => clean(s, max);

export const STALE_AFTER_MS = 10 * 60_000;
export const DROP_BUSY_AFTER_MS = 30 * 60_000;
export const DROP_IDLE_AFTER_MS = 12 * 60 * 60_000;
