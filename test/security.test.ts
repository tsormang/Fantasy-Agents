import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readBody, SESSION_MAX_AGE_S } from "../worker/security";
import { hashToken } from "../worker/auth";

const BASE = "https://realm.test";
let client = 0;
function browser() {
  const ip = `203.0.113.${++client}`;
  return async (path: string, cookie?: string, data?: unknown) => SELF.fetch(`${BASE}/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
async function login(call = browser()) {
  const response = await call("/admin/login", undefined, { token: "test-admin-token" });
  expect(response.status).toBe(200);
  return response.headers.get("Set-Cookie")!.split(";")[0];
}
async function socket(cookie?: string, origin?: string, watch?: string) {
  const response = await SELF.fetch(`${BASE}/api/ws${watch ? `?watch=${watch}` : ""}`, {
    headers: { Upgrade: "websocket", "CF-Connecting-IP": "198.51.100.10", ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
  });
  if (response.status !== 101) return { response, ws: null, messages: [] as any[] };
  const ws = response.webSocket!;
  const messages: any[] = [];
  ws.addEventListener("message", (event) => { messages.push(JSON.parse(event.data as string)); });
  ws.accept();
  return { response, ws, messages };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const realm = () => env.REALM.get(env.REALM.idFromName("realm"));

describe("session and WebSocket security", () => {
  it("rejects foreign, null, and downgraded origins for members and spectators", async () => {
    const call = browser();
    const cookie = await login(call);
    const share = await (await call("/shares", cookie, {})).json() as any;
    for (const origin of ["https://untrusted.example", "null", "http://realm.test"]) {
      expect((await socket(cookie, origin)).response.status).toBe(403);
      expect((await socket(undefined, origin, share.token)).response.status).toBe(403);
    }
    const own = await socket(cookie, BASE);
    expect(own.response.status).toBe(101);
    own.ws!.close();
    const spectator = await socket(undefined, BASE, share.token);
    expect(spectator.response.status).toBe(101);
    spectator.ws!.close();
  });

  it("rejects and deletes expired sessions even when their cookie is replayed", async () => {
    const call = browser();
    const cookie = await login(call);
    await runInDurableObject(realm(), (_object, state) => {
      state.storage.sql.exec("UPDATE sessions SET created = ?", Date.now() - (SESSION_MAX_AGE_S + 1) * 1000);
    });
    expect((await call("/me", cookie)).status).toBe(401);
    expect((await socket(cookie, BASE)).response.status).toBe(401);
    const hash = await hashToken(cookie.slice(cookie.indexOf("=") + 1));
    expect(await runInDurableObject(realm(), (_object, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM sessions WHERE hash = ?", hash).one().n)).toBe(0);
  });

  it("logout closes only that session's sockets and stops further activity delivery", async () => {
    const call = browser();
    const firstCookie = await login(call);
    const otherCookie = await login(call);
    const pair = await (await call("/pair", firstCookie, {})).json() as any;
    const device = await (await call("/connect", undefined, { code: pair.code, pc: "Security test", v: 2 })).json() as any;
    const first = await socket(firstCookie, BASE);
    const other = await socket(otherCookie, BASE);
    await tick();
    const firstMessages = first.messages.length;
    let closed = 0;
    first.ws!.addEventListener("close", (event) => { closed = event.code; });
    expect((await call("/logout", firstCookie, {})).status).toBe(200);
    expect((await call("/me", firstCookie)).status).toBe(401);
    expect((await call("/me", otherCookie)).status).toBe(200);
    const event = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST", headers: { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ v: 2, agent: "codex", session: "after-logout", event: "working" }),
    });
    expect(event.status).toBe(200);
    await tick();
    expect(closed).toBe(4001);
    expect(first.messages.length).toBe(firstMessages);
    expect(other.messages.some((message) => message.t === "agent")).toBe(true);
    other.ws!.close();
  });

  it("schedules session expiry with no active agents and closes idle sockets on expiry", async () => {
    const cookie = await login();
    const connection = await socket(cookie, BASE);
    const scheduled = await runInDurableObject(realm(), (_object, state) => state.storage.getAlarm());
    expect(scheduled).toBeGreaterThan(Date.now());
    expect(scheduled).toBeLessThanOrEqual(Date.now() + SESSION_MAX_AGE_S * 1000);
    let closed = 0;
    connection.ws!.addEventListener("close", (event) => { closed = event.code; });
    await runInDurableObject(realm(), async (object, state) => {
      state.storage.sql.exec("UPDATE sessions SET created = ?", Date.now() - (SESSION_MAX_AGE_S + 1) * 1000);
      await object.alarm();
    });
    await tick();
    expect(closed).toBe(4001);
  });

  it("keeps agent cleanup scheduled when a socket already has a later expiry alarm", async () => {
    const call = browser();
    const cookie = await login(call);
    const connection = await socket(cookie, BASE);
    const pair = await (await call("/pair", cookie, {})).json() as any;
    const device = await (await call("/connect", undefined, { code: pair.code, pc: "Alarm test", v: 2 })).json() as any;
    await SELF.fetch(`${BASE}/api/events`, {
      method: "POST", headers: { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ v: 2, agent: "codex", session: "cleanup", event: "working" }),
    });
    expect(await runInDurableObject(realm(), (_object, state) => state.storage.getAlarm())).toBeLessThanOrEqual(Date.now() + 60_000);
    connection.ws!.close();
  });

  it("caps simultaneous connections for one viewer", async () => {
    const cookie = await login();
    const connections = [];
    for (let i = 0; i < 16; i++) {
      const connection = await socket(cookie, BASE);
      expect(connection.response.status).toBe(101);
      connections.push(connection);
    }
    expect((await socket(cookie, BASE)).response.status).toBe(429);
    for (const connection of connections) connection.ws!.close();
  });
});

describe("request abuse protection", () => {
  it("limits repeated authentication requests per client and resets after the window", async () => {
    const call = browser();
    for (let i = 0; i < 20; i++) expect((await call("/admin/login", undefined, { token: "wrong" })).status).toBe(401);
    const limited = await call("/admin/login", undefined, { token: "wrong" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await browser()("/admin/login", undefined, { token: "wrong" })).status).toBe(401);
    await runInDurableObject(realm(), (_object, state) => state.storage.sql.exec("UPDATE rate_limits SET window = 0").toArray());
    expect((await call("/admin/login", undefined, { token: "wrong" })).status).toBe(401);
  });

  it("returns 413 for oversized bodies and 400 for malformed JSON", async () => {
    for (const [body, status] of [[JSON.stringify({ token: "x".repeat(4096) }), 413], ["{broken", 400]] as const) {
      const response = await SELF.fetch(`${BASE}/api/admin/login`, { method: "POST", body, headers: { "CF-Connecting-IP": "198.51.100.20" } });
      expect(response.status).toBe(status);
    }
  });

  it("cancels an oversized stream before reading the remaining chunks", async () => {
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(2048)); },
      cancel() { cancelled = true; },
    });
    await expect(readBody(new Request(BASE, { method: "POST", body: stream }))).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThanOrEqual(4);
  });

  it("measures UTF-8 bytes and accepts valid JSON within the limit", async () => {
    const value = { name: "Δοκιμή" };
    expect(await readBody(new Request(BASE, { method: "POST", body: JSON.stringify(value) }))).toEqual(value);
    await expect(readBody(new Request(BASE, { method: "POST", body: JSON.stringify({ name: "界".repeat(1500) }) }))).rejects.toMatchObject({ status: 413 });
  });
});
