import { DurableObject } from "cloudflare:workers";
import {
  type AgentState,
  type ServerMsg,
  AGENT_KINDS,
  DROP_BUSY_AFTER_MS,
  DROP_IDLE_AFTER_MS,
  STALE_AFTER_MS,
  cleanName,
  parseEvent,
} from "../shared/protocol";
import { COOKIE, bearer, hashToken, newId, newToken, readCookie, sameOrigin, sessionCookie } from "./auth";
import type { Env } from "./index";

const YEAR_S = 365 * 24 * 3600;
const PAIR_TTL_MS = 10 * 60_000;
const ALARM_EVERY_MS = 60_000;

interface Member {
  id: string;
  name: string;
  role: "owner" | "member";
}
type Viewer = { kind: "member"; member: Member } | { kind: "spectator" };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
const err = (status: number, message: string): Response => json({ error: message }, status);

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 4096) return {};
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export class Realm extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, note TEXT NOT NULL, expires INTEGER NOT NULL, used_by TEXT);
      CREATE TABLE IF NOT EXISTS pairings (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, member_id TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS device_agents (device_id TEXT NOT NULL, agent TEXT NOT NULL, installed INTEGER NOT NULL, seen INTEGER, PRIMARY KEY (device_id, agent));
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, agent TEXT NOT NULL, project TEXT NOT NULL,
        status TEXT NOT NULL, activity TEXT, since INTEGER NOT NULL, last INTEGER NOT NULL, kills INTEGER NOT NULL);
    `);
    try {
      // Added after the first release: whether the connector told us which tools it set up.
      this.sql.exec("ALTER TABLE devices ADD COLUMN reported INTEGER NOT NULL DEFAULT 0");
    } catch {
      /* column already exists */
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------------------------------------------------------------- routing

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    const m = req.method;
    try {
      if (path === "/events" && m === "POST") return await this.postEvent(req);
      if (path === "/connect" && m === "POST") return await this.connectDevice(req);
      if (path === "/ping" && m === "POST") return await this.ping(req);
      if (path === "/ws" && m === "GET") return await this.openSocket(req, url);

      if (m !== "GET" && !sameOrigin(req)) return err(403, "Cross-origin request refused");

      if (path === "/admin/login" && m === "POST") return await this.adminLogin(req);
      if (path === "/join" && m === "POST") return await this.join(req);
      if (path === "/logout" && m === "POST") return await this.logout(req);
      if (path === "/me" && m === "GET") {
        const me = await this.member(req);
        return me ? json({ member: me }) : err(401, "Not signed in");
      }

      const me = await this.member(req);
      if (!me) return err(401, "Not signed in");

      if (path === "/pair" && m === "POST") return await this.createPairing(me);
      if (path === "/devices" && m === "GET") return this.listDevices(me);
      const dev = path.match(/^\/devices\/([\w-]+)$/);
      if (dev && m === "DELETE") return this.deleteDevice(me, dev[1]);

      if (me.role !== "owner") return err(403, "Owner only");

      if (path === "/invites" && m === "GET") return this.listInvites();
      if (path === "/invites" && m === "POST") return await this.createInvite(req);
      const inv = path.match(/^\/invites\/([\w-]+)$/);
      if (inv && m === "DELETE") {
        this.sql.exec("DELETE FROM invites WHERE id = ?", inv[1]);
        return json({ ok: true });
      }
      if (path === "/shares" && m === "GET")
        return json({ shares: this.sql.exec("SELECT id, label, created FROM shares ORDER BY created DESC").toArray() });
      if (path === "/shares" && m === "POST") return await this.createShare(req);
      const sh = path.match(/^\/shares\/([\w-]+)$/);
      if (sh && m === "DELETE") {
        this.sql.exec("DELETE FROM shares WHERE id = ?", sh[1]);
        this.closeSockets((tag) => tag === `share:${sh[1]}`);
        return json({ ok: true });
      }
      if (path === "/members" && m === "GET")
        return json({ members: this.sql.exec("SELECT id, name, role, created FROM members ORDER BY created").toArray() });
      const mem = path.match(/^\/members\/([\w-]+)$/);
      if (mem && m === "DELETE") return this.deleteMember(me, mem[1]);

      return err(404, "Not found");
    } catch (e) {
      console.error(e);
      return err(500, "Internal error");
    }
  }

  // ------------------------------------------------------------------- auth

  private async member(req: Request): Promise<Member | null> {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const rows = this.sql
      .exec(
        "SELECT m.id, m.name, m.role FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.hash = ?",
        await hashToken(token),
      )
      .toArray();
    return rows.length ? (rows[0] as unknown as Member) : null;
  }

  private async viewer(req: Request, url: URL): Promise<(Viewer & { tag: string }) | null> {
    const watch = url.searchParams.get("watch");
    if (watch) {
      const rows = this.sql.exec("SELECT id FROM shares WHERE hash = ?", await hashToken(watch)).toArray();
      return rows.length ? { kind: "spectator", tag: `share:${rows[0].id}` } : null;
    }
    const me = await this.member(req);
    return me ? { kind: "member", member: me, tag: `member:${me.id}` } : null;
  }

  private async startSession(memberId: string): Promise<string> {
    const token = newToken();
    this.sql.exec("INSERT INTO sessions (hash, member_id, created) VALUES (?, ?, ?)", await hashToken(token), memberId, Date.now());
    return sessionCookie(token, YEAR_S);
  }

  private async adminLogin(req: Request): Promise<Response> {
    const secret = this.env.ADMIN_TOKEN;
    if (!secret) return err(503, "ADMIN_TOKEN is not configured on the server");
    const { token } = await body(req);
    if (typeof token !== "string" || (await hashToken(token)) !== (await hashToken(secret))) return err(401, "Wrong token");
    let owner = this.sql.exec("SELECT id, name, role FROM members WHERE role = 'owner' LIMIT 1").toArray()[0] as unknown as Member | undefined;
    if (!owner) {
      owner = { id: newId(), name: "Owner", role: "owner" };
      this.sql.exec("INSERT INTO members (id, name, role, created) VALUES (?, ?, 'owner', ?)", owner.id, owner.name, Date.now());
    }
    return json({ member: owner }, 200, { "Set-Cookie": await this.startSession(owner.id) });
  }

  private async join(req: Request): Promise<Response> {
    const b = await body(req);
    const name = cleanName(b.name);
    if (typeof b.code !== "string" || !name) return err(400, "Invite code and a name are required");
    const rows = this.sql.exec("SELECT id, expires, used_by FROM invites WHERE hash = ?", await hashToken(b.code)).toArray();
    const inv = rows[0];
    if (!inv || inv.used_by || (inv.expires as number) < Date.now()) return err(403, "This invite is invalid, used or expired");
    const member: Member = { id: newId(), name, role: "member" };
    this.sql.exec("INSERT INTO members (id, name, role, created) VALUES (?, ?, 'member', ?)", member.id, name, Date.now());
    this.sql.exec("UPDATE invites SET used_by = ? WHERE id = ?", member.id, inv.id);
    return json({ member }, 200, { "Set-Cookie": await this.startSession(member.id) });
  }

  private async logout(req: Request): Promise<Response> {
    const token = readCookie(req, COOKIE);
    if (token) this.sql.exec("DELETE FROM sessions WHERE hash = ?", await hashToken(token));
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  // ------------------------------------------------- invites, shares, members

  private listInvites(): Response {
    const invites = this.sql
      .exec(
        "SELECT i.id, i.note, i.expires, m.name AS used_by FROM invites i LEFT JOIN members m ON m.id = i.used_by ORDER BY i.expires DESC",
      )
      .toArray();
    return json({ invites });
  }

  private async createInvite(req: Request): Promise<Response> {
    const b = await body(req);
    const days = Math.min(Math.max(Number(b.days) || 7, 1), 90);
    const code = newToken(18);
    const id = newId();
    this.sql.exec(
      "INSERT INTO invites (id, hash, note, expires, used_by) VALUES (?, ?, ?, ?, NULL)",
      id,
      await hashToken(code),
      cleanName(b.note, 40),
      Date.now() + days * 86_400_000,
    );
    return json({ id, code });
  }

  private async createShare(req: Request): Promise<Response> {
    const b = await body(req);
    const token = newToken(18);
    const id = newId();
    this.sql.exec("INSERT INTO shares (id, hash, label, created) VALUES (?, ?, ?, ?)", id, await hashToken(token), cleanName(b.label, 40), Date.now());
    return json({ id, token });
  }

  private deleteMember(me: Member, id: string): Response {
    if (id === me.id) return err(400, "You cannot remove yourself");
    const devices = this.sql.exec("SELECT id FROM devices WHERE member_id = ?", id).toArray();
    for (const d of devices) this.dropDevice(d.id as string);
    this.sql.exec("DELETE FROM sessions WHERE member_id = ?", id);
    this.sql.exec("DELETE FROM pairings WHERE member_id = ?", id);
    this.sql.exec("DELETE FROM members WHERE id = ?", id);
    this.closeSockets((tag) => tag === `member:${id}`);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- devices

  private async createPairing(me: Member): Promise<Response> {
    this.sql.exec("DELETE FROM pairings WHERE expires < ?", Date.now());
    const code = newToken(15);
    const expires = Date.now() + PAIR_TTL_MS;
    this.sql.exec("INSERT INTO pairings (hash, member_id, expires) VALUES (?, ?, ?)", await hashToken(code), me.id, expires);
    return json({ code, expires });
  }

  /** Called by the connector: trade a single-use pairing code for a device token. */
  private async connectDevice(req: Request): Promise<Response> {
    const b = await body(req);
    const pc = cleanName(b.pc) || "Unnamed PC";
    if (typeof b.code !== "string") return err(400, "Pairing code required");
    const hash = await hashToken(b.code);
    const row = this.sql.exec("SELECT member_id, expires FROM pairings WHERE hash = ?", hash).toArray()[0];
    this.sql.exec("DELETE FROM pairings WHERE hash = ?", hash);
    if (!row || (row.expires as number) < Date.now()) return err(403, "Pairing code is invalid or expired");
    const token = newToken();
    const id = newId();
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO devices (id, hash, member_id, name, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      await hashToken(token),
      row.member_id,
      pc,
      now,
      now,
    );
    // Which agent tools the connector is installing hooks for, so the UI can offer a per-agent test.
    this.reportAgents(id, b.agents);
    return json({ token, deviceId: id, pc });
  }

  /** Lets the connector prove that its saved token and the network path work. */
  private async ping(req: Request): Promise<Response> {
    const token = bearer(req);
    const device = token ? this.sql.exec("SELECT id, name FROM devices WHERE hash = ?", await hashToken(token)).toArray()[0] : null;
    if (!device) return err(401, "Unknown or revoked device");
    this.sql.exec("UPDATE devices SET last_seen = ? WHERE id = ?", Date.now(), device.id);
    this.reportAgents(device.id as string, (await body(req)).agents);
    return json({ ok: true, pc: device.name });
  }

  /** The connector's list of tools it has hooks in. Without it we cannot tell "not set up" from "not heard from yet". */
  private reportAgents(deviceId: string, agents: unknown): void {
    if (!Array.isArray(agents)) return;
    for (const k of AGENT_KINDS.filter((x) => agents.includes(x)))
      this.sql.exec("INSERT OR IGNORE INTO device_agents (device_id, agent, installed, seen) VALUES (?, ?, 1, NULL)", deviceId, k);
    this.sql.exec("UPDATE devices SET reported = 1 WHERE id = ?", deviceId);
  }

  private listDevices(me: Member): Response {
    const q =
      "SELECT d.id, d.name, d.created, d.last_seen, d.reported, m.name AS owner FROM devices d JOIN members m ON m.id = d.member_id";
    const devices =
      me.role === "owner"
        ? this.sql.exec(`${q} ORDER BY d.created`).toArray()
        : this.sql.exec(`${q} WHERE d.member_id = ? ORDER BY d.created`, me.id).toArray();
    const hooks = this.sql.exec("SELECT device_id, agent, seen FROM device_agents WHERE installed = 1").toArray();
    return json({
      now: Date.now(),
      devices: devices.map((d) => ({
        ...d,
        agents: hooks.filter((h) => h.device_id === d.id).map((h) => ({ agent: h.agent, seen: h.seen })),
      })),
    });
  }

  private deleteDevice(me: Member, id: string): Response {
    const row = this.sql.exec("SELECT member_id FROM devices WHERE id = ?", id).toArray()[0];
    if (!row) return err(404, "No such device");
    if (me.role !== "owner" && row.member_id !== me.id) return err(403, "Not your device");
    this.dropDevice(id);
    return json({ ok: true });
  }

  private dropDevice(id: string): void {
    const agents = this.sql.exec("SELECT id FROM agents WHERE device_id = ?", id).toArray();
    this.sql.exec("DELETE FROM agents WHERE device_id = ?", id);
    this.sql.exec("DELETE FROM device_agents WHERE device_id = ?", id);
    this.sql.exec("DELETE FROM devices WHERE id = ?", id);
    for (const a of agents) this.broadcast({ t: "gone", id: a.id as string });
  }

  // ----------------------------------------------------------------- events

  private async postEvent(req: Request): Promise<Response> {
    const token = bearer(req);
    if (!token) return err(401, "Device token required");
    const device = this.sql.exec("SELECT id, last_seen FROM devices WHERE hash = ?", await hashToken(token)).toArray()[0];
    if (!device) return err(401, "Unknown or revoked device");
    const ev = parseEvent(await body(req));
    if (!ev) return err(400, "Malformed event");

    const now = Date.now();
    if (now - (device.last_seen as number) > 60_000) this.sql.exec("UPDATE devices SET last_seen = ? WHERE id = ?", now, device.id);

    // Record that this agent's hooks really fire on this PC (drives the setup checklist).
    const seen = this.sql.exec("SELECT seen FROM device_agents WHERE device_id = ? AND agent = ?", device.id, ev.agent).toArray()[0];
    if (!seen || !seen.seen || now - (seen.seen as number) > 5_000) {
      this.sql.exec(
        "INSERT INTO device_agents (device_id, agent, installed, seen) VALUES (?, ?, 1, ?) ON CONFLICT(device_id, agent) DO UPDATE SET installed = 1, seen = excluded.seen",
        device.id,
        ev.agent,
        now,
      );
    }

    const id = `${device.id}:${ev.agent}:${ev.session}`;
    if (ev.event === "end") {
      this.sql.exec("DELETE FROM agents WHERE id = ?", id);
      this.broadcast({ t: "gone", id });
      return json({ ok: true });
    }

    const prev = this.sql.exec("SELECT project, status, activity, since, kills FROM agents WHERE id = ?", id).toArray()[0];
    let status = (prev?.status as string) ?? "idle";
    let activity = (prev?.activity as string | null) ?? null;
    let since = (prev?.since as number) ?? now;
    let kills = (prev?.kills as number) ?? 0;
    const wasBusy = status === "working" || status === "waiting";

    switch (ev.event) {
      case "start":
        if (status === "stale") status = "idle";
        break;
      case "working":
        status = "working";
        activity = "think";
        since = now;
        kills = 0;
        break;
      case "activity":
        if (!wasBusy) {
          since = now;
          kills = 0;
        }
        status = "working";
        activity = ev.activity ?? "think";
        // "think" is a heartbeat between tool calls, not a blow landed
        if (activity !== "think") kills += 1;
        break;
      case "waiting":
        if (!wasBusy) since = now;
        status = "waiting";
        break;
      case "idle":
        status = "idle";
        activity = null;
        since = now;
        break;
    }
    const project = ev.project ?? (prev?.project as string) ?? "";

    this.sql.exec(
      `INSERT INTO agents (id, device_id, agent, project, status, activity, since, last, kills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project = excluded.project, status = excluded.status, activity = excluded.activity,
         since = excluded.since, last = excluded.last, kills = excluded.kills`,
      id,
      device.id,
      ev.agent,
      project,
      status,
      activity,
      since,
      now,
      kills,
    );
    const agent = this.agents(id)[0];
    if (agent) this.broadcast({ t: "agent", agent, now });
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + ALARM_EVERY_MS);
    return json({ ok: true });
  }

  private agents(id?: string): AgentState[] {
    const q = `SELECT a.id, a.agent, d.name AS pc, d.id AS pcId, m.name AS owner, a.project, a.status, a.activity, a.since, a.last, a.kills
               FROM agents a JOIN devices d ON d.id = a.device_id JOIN members m ON m.id = d.member_id`;
    const cur = id ? this.sql.exec(`${q} WHERE a.id = ?`, id) : this.sql.exec(`${q} ORDER BY a.since`);
    return cur.toArray() as unknown as AgentState[];
  }

  /** Heroes whose PC went quiet fade to "stale", then leave. */
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const a of this.agents()) {
      const quiet = now - a.last;
      const busy = a.status !== "idle";
      if ((busy && quiet > DROP_BUSY_AFTER_MS) || (!busy && quiet > DROP_IDLE_AFTER_MS)) {
        this.sql.exec("DELETE FROM agents WHERE id = ?", a.id);
        this.broadcast({ t: "gone", id: a.id });
      } else if ((a.status === "working" || a.status === "waiting") && quiet > STALE_AFTER_MS) {
        this.sql.exec("UPDATE agents SET status = 'stale' WHERE id = ?", a.id);
        this.broadcast({ t: "agent", agent: { ...a, status: "stale" }, now });
      }
    }
    const left = this.sql.exec("SELECT COUNT(*) AS n FROM agents").one().n as number;
    if (left > 0) await this.ctx.storage.setAlarm(now + ALARM_EVERY_MS);
  }

  // ------------------------------------------------------------- websockets

  private async openSocket(req: Request, url: URL): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return err(426, "WebSocket expected");
    const viewer = await this.viewer(req, url);
    if (!viewer) return err(401, "Not allowed to watch");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [viewer.tag]);
    const snapshot: ServerMsg = { t: "snapshot", agents: this.agents(), now: Date.now() };
    pair[1].send(JSON.stringify(snapshot));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(): void {
    // Viewers are read-only; "ping" is answered by the auto-response without waking us.
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      /* already closed */
    }
  }

  private broadcast(msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* socket is gone */
      }
    }
  }

  private closeSockets(match: (tag: string) => boolean): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.ctx.getTags(ws).some(match)) {
        try {
          ws.close(4001, "Access revoked");
        } catch {
          /* already closed */
        }
      }
    }
  }
}
