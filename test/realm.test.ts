import { SELF, env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../shared/protocol";

const BASE = "https://realm.test";

async function api(path: string, init: { method?: string; cookie?: string; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
  const res = await SELF.fetch(`${BASE}/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const cookie = res.headers.get("Set-Cookie")?.split(";")[0];
  return { status: res.status, data: (await res.json()) as any, cookie };
}

async function owner() {
  const r = await api("/admin/login", { body: { token: "test-admin-token" } });
  expect(r.status).toBe(200);
  return r.cookie!;
}

async function memberWithDevice(name = "Ada", pc = "Forge-PC") {
  const own = await owner();
  const inv = await api("/invites", { cookie: own, body: { note: "friend" } });
  const joined = await api("/join", { body: { code: inv.data.code, name } });
  expect(joined.status).toBe(200);
  const pair = await api("/pair", { cookie: joined.cookie, method: "POST" });
  const dev = await api("/connect", { body: { code: pair.data.code, pc } });
  expect(dev.status).toBe(200);
  return { own, cookie: joined.cookie!, invite: inv.data.code as string, pairCode: pair.data.code as string, device: dev.data };
}

async function watch(query: string, cookie?: string) {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (cookie) headers.Cookie = cookie;
  const res = await SELF.fetch(`${BASE}/api/ws${query}`, { headers });
  if (res.status !== 101) return { status: res.status, msgs: [] as ServerMsg[], ws: null };
  const ws = res.webSocket!;
  const msgs: ServerMsg[] = [];
  ws.addEventListener("message", (e) => {
    msgs.push(JSON.parse(e.data as string));
  });
  ws.accept();
  return { status: 101, msgs, ws };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("auth", () => {
  it("rejects a wrong admin token and unauthenticated calls", async () => {
    expect((await api("/admin/login", { body: { token: "nope" } })).status).toBe(401);
    expect((await api("/me")).status).toBe(401);
    expect((await api("/pair", { method: "POST" })).status).toBe(401);
    expect((await watch("")).status).toBe(401);
  });

  it("invites are single use and pairing codes are single use", async () => {
    const m = await memberWithDevice();
    expect((await api("/join", { body: { code: m.invite, name: "Eve" } })).status).toBe(403);
    expect((await api("/connect", { body: { code: m.pairCode, pc: "Other" } })).status).toBe(403);
  });

  it("members cannot use owner endpoints", async () => {
    const m = await memberWithDevice();
    expect((await api("/invites", { cookie: m.cookie })).status).toBe(403);
    expect((await api("/shares", { cookie: m.cookie, body: { label: "tv" } })).status).toBe(403);
  });

  it("refuses cross-origin cookie mutations", async () => {
    const own = await owner();
    const res = await SELF.fetch(`${BASE}/api/invites`, {
      method: "POST",
      headers: { Cookie: own, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("events", () => {
  it("rejects unknown devices and malformed events", async () => {
    const ev = { v: 2, agent: "claude", session: "s1", event: "working" };
    expect((await api("/events", { bearer: "bogus", body: ev })).status).toBe(401);
    const m = await memberWithDevice();
    expect((await api("/events", { bearer: m.device.token, body: { ...ev, agent: "hal" } })).status).toBe(400);
    expect((await api("/events", { bearer: m.device.token, body: { ...ev, session: "../x" } })).status).toBe(400);
  });

  it("broadcasts the agent lifecycle to viewers and drops unknown fields", async () => {
    const m = await memberWithDevice("Ada", "Forge-PC");
    const v = await watch("", m.cookie);
    expect(v.status).toBe(101);
    const send = (body: object) => api("/events", { bearer: m.device.token, body: { v: 2, agent: "claude", session: "abc", ...body } });

    await send({ event: "working", project: "my-app", prompt: "secret prompt text" });
    await send({ event: "activity", activity: "edit" });
    await send({ event: "activity", activity: "command" });
    await send({ event: "waiting" });
    await send({ event: "idle" });
    await send({ event: "end" });
    await tick();

    expect(v.msgs[0].t).toBe("snapshot");
    const mine = v.msgs.filter((x) => x.t === "agent" && x.agent.pcId === m.device.deviceId) as Extract<ServerMsg, { t: "agent" }>[];
    expect(mine.map((x) => x.agent.status)).toEqual(["working", "working", "working", "waiting", "idle"]);
    expect(mine[0].agent).toMatchObject({ agent: "claude", pc: "Forge-PC", owner: "Ada", project: "my-app", activity: "think" });
    expect(mine[2].agent).toMatchObject({ activity: "command", kills: 2 });
    expect(JSON.stringify(v.msgs)).not.toContain("secret");
    expect(v.msgs.at(-1)).toMatchObject({ t: "gone" });
    v.ws!.close();
  });

  it("marks quiet working agents stale, then removes them", async () => {
    const m = await memberWithDevice();
    await api("/events", { bearer: m.device.token, body: { v: 2, agent: "codex", session: "quiet", event: "working" } });
    const stub = env.REALM.get(env.REALM.idFromName("realm"));
    const id = `${m.device.deviceId}:codex:quiet`;
    const age = (ms: number) =>
      runInDurableObject(stub, (_o, state) => {
        state.storage.sql.exec("UPDATE agents SET last = ? WHERE id = ?", Date.now() - ms, id);
      });
    const status = () =>
      runInDurableObject(stub, (_o, state) => state.storage.sql.exec("SELECT status FROM agents WHERE id = ?", id).toArray()[0]?.status);

    await age(11 * 60_000);
    await runDurableObjectAlarm(stub);
    expect(await status()).toBe("stale");

    await age(31 * 60_000);
    await runInDurableObject(stub, (o) => o.alarm());
    expect(await status()).toBeUndefined();
  });
});

describe("privacy", () => {
  it("refuses old connectors that report every folder, forgets their heroes and flags the PC", async () => {
    const m = await memberWithDevice("Ada", "Old-PC");
    const proto = async () => (await api("/devices", { cookie: m.cookie })).data.devices.find((d: any) => d.id === m.device.deviceId).proto;
    const v2 = { v: 2, agent: "claude", session: "live", event: "working", project: "shared-app" };
    expect((await api("/events", { bearer: m.device.token, body: v2 })).status).toBe(200);
    expect(await proto()).toBe(2);

    const v = await watch("", m.cookie);
    const old = await api("/events", { bearer: m.device.token, body: { v: 1, agent: "claude", session: "x", event: "working", project: "corp-secret" } });
    expect(old.status).toBe(426);
    await tick();
    expect(await proto()).toBe(1);
    expect(JSON.stringify(v.msgs.slice(1))).not.toContain("corp-secret");
    expect(v.msgs.at(-1)).toMatchObject({ t: "gone", id: `${m.device.deviceId}:claude:live` });
    v.ws!.close();

    const stub = env.REALM.get(env.REALM.idFromName("realm"));
    const stored = await runInDurableObject(stub, (_o, state) =>
      state.storage.sql.exec("SELECT project FROM agents WHERE device_id = ?", m.device.deviceId).toArray(),
    );
    expect(stored).toEqual([]);
  });

  it("stores and shows spectators only the documented fields", async () => {
    const m = await memberWithDevice("Ada", "Forge-PC");
    const share = await api("/shares", { cookie: m.own, body: { label: "TV" } });
    await api("/events", {
      bearer: m.device.token,
      body: { v: 2, agent: "cursor", session: "spec", event: "activity", activity: "edit", project: "alias", cwd: "C:\corp\secret", tool_input: "rm -rf" },
    });
    const v = await watch(`?watch=${share.data.token}`);
    await tick();
    const snap = v.msgs[0] as Extract<ServerMsg, { t: "snapshot" }>;
    const hero = snap.agents.find((a) => a.id === `${m.device.deviceId}:cursor:spec`)!;
    expect(Object.keys(hero).sort()).toEqual(["activity", "agent", "id", "kills", "last", "owner", "pc", "pcId", "project", "since", "status"]);
    expect(JSON.stringify(snap)).not.toMatch(/corp|rm -rf/);
    v.ws!.close();

    const stub = env.REALM.get(env.REALM.idFromName("realm"));
    const dump = await runInDurableObject(stub, (_o, state) => {
      const sql = state.storage.sql;
      return JSON.stringify([sql.exec("SELECT * FROM agents").toArray(), sql.exec("SELECT * FROM devices").toArray(), sql.exec("SELECT * FROM device_agents").toArray()]);
    });
    expect(dump).not.toMatch(/corp|rm -rf/);
    // device tokens are stored hashed only
    expect(dump).not.toContain(m.device.token);
  });
});

describe("setup checklist", () => {
  it("marks only the signed-in member's devices as editable, including for village owners", async () => {
    const m = await memberWithDevice("Editor", "Member PC");
    const pair = await api("/pair", { cookie: m.own, method: "POST" });
    const ownDevice = await api("/connect", { body: { code: pair.data.code, pc: "Owner PC" } });
    const ownerDevices = (await api("/devices", { cookie: m.own })).data.devices;
    expect(ownerDevices.find((d: any) => d.id === m.device.deviceId).editable).toBe(false);
    expect(ownerDevices.find((d: any) => d.id === ownDevice.data.deviceId).editable).toBe(true);
    const memberDevices = (await api("/devices", { cookie: m.cookie })).data.devices;
    expect(memberDevices.find((d: any) => d.id === m.device.deviceId).editable).toBe(true);
    expect(memberDevices.some((d: any) => d.id === ownDevice.data.deviceId)).toBe(false);
  });
  it("tracks which agents have hooks installed and which have reported in", async () => {
    const own = await owner();
    const pair = await api("/pair", { cookie: own, method: "POST" });
    const dev = await api("/connect", { body: { code: pair.data.code, pc: "Check-PC", agents: ["claude", "codex", "hal"] } });
    const mine = async () => (await api("/devices", { cookie: own })).data.devices.find((d: any) => d.id === dev.data.deviceId);

    expect((await mine()).agents).toEqual([
      { agent: "claude", seen: null },
      { agent: "codex", seen: null },
    ]);
    expect((await api("/ping", { bearer: dev.data.token, method: "POST" })).data).toMatchObject({ ok: true, pc: "Check-PC" });
    expect((await api("/ping", { bearer: "bogus", method: "POST" })).status).toBe(401);

    await api("/events", { bearer: dev.data.token, body: { v: 2, agent: "codex", session: "t", event: "working" } });
    // an agent the connector did not report still shows up once it sends events
    await api("/events", { bearer: dev.data.token, body: { v: 2, agent: "cursor", session: "t", event: "working" } });
    const agents = (await mine()).agents as { agent: string; seen: number | null }[];
    expect(agents.find((a) => a.agent === "claude")!.seen).toBeNull();
    expect(agents.find((a) => a.agent === "codex")!.seen).toBeGreaterThan(0);
    expect(agents.find((a) => a.agent === "cursor")!.seen).toBeGreaterThan(0);
  });
});

describe("revocation", () => {
  it("a revoked device can no longer post", async () => {
    const m = await memberWithDevice();
    expect((await api(`/devices/${m.device.deviceId}`, { cookie: m.cookie, method: "DELETE" })).status).toBe(200);
    const r = await api("/events", { bearer: m.device.token, body: { v: 2, agent: "claude", session: "s", event: "working" } });
    expect(r.status).toBe(401);
  });

  it("spectator links work until revoked", async () => {
    const own = await owner();
    const share = await api("/shares", { cookie: own, body: { label: "TV" } });
    expect((await watch(`?watch=${share.data.token}`)).status).toBe(101);
    expect((await watch("?watch=wrong")).status).toBe(401);
    await api(`/shares/${share.data.id}`, { cookie: own, method: "DELETE" });
    expect((await watch(`?watch=${share.data.token}`)).status).toBe(401);
  });
});
