import type { AgentState, ServerMsg } from "../../shared/protocol";

/** Live agent state, fed either by the WebSocket or by the demo script. */
export class Store {
  memberId: string | null = null;
  agents = new Map<string, AgentState>();
  connected = false;
  denied = false;
  /** true once the first snapshot has arrived */
  ready = false;
  /** server clock minus local clock */
  offset = 0;
  private listeners = new Set<() => void>();

  now(): number {
    return Date.now() + this.offset;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  apply(msg: ServerMsg): void {
    if (msg.t === "snapshot") {
      this.ready = true;
      this.offset = msg.now - Date.now();
      this.agents = new Map(msg.agents.map((a) => [a.id, a]));
    } else if (msg.t === "agent") {
      this.agents.set(msg.agent.id, msg.agent);
    } else if (msg.t === "gone") {
      this.agents.delete(msg.id);
    }
    this.emit();
  }
}

/** Connect to the realm and keep reconnecting. `watch` is a spectator token, if any. */
export function connect(store: Store, watch?: string): void {
  let delay = 1000;
  let opened = false;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws${watch ? `?watch=${encodeURIComponent(watch)}` : ""}`);
    let ping = 0;
    ws.onopen = () => {
      opened = true;
      delay = 1000;
      store.connected = true;
      store.emit();
      ping = window.setInterval(() => ws.readyState === 1 && ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        store.apply(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = (e) => {
      clearInterval(ping);
      store.connected = false;
      // 4001 = access revoked; never opening at all usually means the link is invalid.
      if (e.code === 4001 || (!opened && watch)) {
        store.denied = true;
        store.emit();
        return;
      }
      store.emit();
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15_000);
    };
  };
  open();
}
