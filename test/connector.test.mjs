import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { activityFor, addHooks, mapHook, projectFor, projectName, removeHooks } from "../connector/fa.mjs";

const FA = fileURLToPath(new URL("../connector/fa.mjs", import.meta.url));

// A throwaway disk layout: one allowed project, one private one, and a git worktree of the allowed one.
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "fa-test-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const dir = (...parts) => {
  const d = path.join(tmp, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const OPEN = dir("work", "my-app");
const OPEN_SUB = dir("work", "my-app", "packages", "api");
const SECRET = dir("work", "secret-client");
const LOOKALIKE = dir("work", "my-app-internal");
const WORKTREE = dir("trees", "feature-x");
fs.mkdirSync(path.join(OPEN, ".git", "worktrees", "feature-x"), { recursive: true });
// git writes this pointer file into every linked worktree
fs.writeFileSync(path.join(WORKTREE, ".git"), `gitdir: ${path.join(OPEN, ".git", "worktrees", "feature-x").replace(/\\/g, "/")}\n`);
const WORKTREE_SUB = dir("trees", "feature-x", "packages", "api");
const FOREIGN_TREE = dir("trees", "other");
fs.mkdirSync(path.join(SECRET, ".git", "worktrees", "other"), { recursive: true });
fs.writeFileSync(path.join(FOREIGN_TREE, ".git"), `gitdir: ${path.join(SECRET, ".git", "worktrees", "other")}\n`);

const CFG = { url: "http://127.0.0.1:1", token: "device-token", projects: [{ path: OPEN }] };
const hookIn = (cwd, extra = {}) => ({ hook_event_name: "PreToolUse", session_id: "abc-123", cwd, tool_name: "Bash", ...extra });

test("privacy: only allow-listed fields leave the machine", () => {
  const ev = mapHook(
    "claude",
    hookIn(OPEN_SUB + path.sep, {
      tool_input: { command: "curl -H 'Authorization: token hunter2' https://internal" },
      prompt: "top secret prompt",
      transcript_path: path.join(tmp, "transcripts", "x.jsonl"),
    }),
    CFG,
  );
  assert.deepEqual(Object.keys(ev).sort(), ["activity", "agent", "event", "project", "session", "v"]);
  assert.equal(ev.v, 2);
  assert.equal(ev.project, "my-app", "the allowed folder's name, not the subfolder the agent is in");
  assert.equal(ev.activity, "command");
  assert.match(ev.session, /^[0-9a-f]{16}$/);
  const wire = JSON.stringify(ev);
  for (const leak of ["hunter2", "secret", "abc-123", "packages", "api", path.basename(tmp), "device-token"]) assert.ok(!wire.includes(leak), leak);
});

test("allow-list: a folder that is not allowed maps to nothing", () => {
  for (const cwd of [SECRET, LOOKALIKE, path.dirname(OPEN), tmp, FOREIGN_TREE, "", undefined, "relative/my-app"]) {
    assert.equal(mapHook("claude", hookIn(cwd), CFG), null, String(cwd));
  }
  // opt-in: a PC with no list, an empty list or a broken list shares nothing
  for (const projects of [undefined, [], "all", [{}], [{ path: "my-app" }]]) {
    assert.equal(mapHook("claude", hookIn(OPEN), { ...CFG, projects }), null, JSON.stringify(projects));
  }
  assert.equal(mapHook("claude", hookIn(OPEN), null), null);
  assert.equal(mapHook("claude", hookIn(OPEN), { projects: CFG.projects }), null, "not connected");
});

test("allow-list: subfolders and git worktrees of an allowed folder are covered", () => {
  assert.equal(projectFor(OPEN, CFG.projects).path, OPEN);
  assert.equal(projectFor(OPEN_SUB, CFG.projects).path, OPEN);
  assert.equal(projectFor(WORKTREE, CFG.projects).path, OPEN);
  assert.equal(projectFor(WORKTREE_SUB, CFG.projects).path, OPEN);
  assert.equal(mapHook("claude", hookIn(WORKTREE_SUB), CFG).project, "my-app", "the worktree's own folder name is not sent");
  // only part of a repo is allowed: the same part of its worktree is, the rest is not
  const partial = [{ path: OPEN_SUB }];
  assert.equal(projectFor(WORKTREE_SUB, partial).path, OPEN_SUB);
  assert.equal(projectFor(WORKTREE, partial), null);
  assert.equal(projectFor(OPEN, partial), null);
  if (process.platform === "win32") assert.equal(projectFor(OPEN.toUpperCase(), CFG.projects).path, OPEN);
});

test("allow-list: an alias replaces the folder name, and the most specific entry wins", () => {
  const projects = [{ path: OPEN, name: "  side project  " }, { path: OPEN_SUB, name: "x".repeat(60) }];
  const ev = mapHook("codex", hookIn(OPEN), { ...CFG, projects });
  assert.equal(ev.project, "side project");
  assert.ok(!JSON.stringify(ev).includes("my-app"));
  assert.equal(mapHook("codex", hookIn(OPEN_SUB), { ...CFG, projects }).project, "x".repeat(40));
  assert.equal(projectName({ path: OPEN, name: "\u0007" }), "my-app");
});

test("session ids are keyed per device: stable, not recomputable from the raw id", () => {
  const a = mapHook("claude", hookIn(OPEN), CFG).session;
  assert.equal(mapHook("claude", hookIn(OPEN_SUB), CFG).session, a, "stable within a device");
  assert.notEqual(mapHook("claude", hookIn(OPEN), { ...CFG, token: "another-device" }).session, a, "differs per device");
  assert.notEqual(mapHook("claude", hookIn(OPEN, { session_id: "abc-124" }), CFG).session, a);
});

test("event mapping per agent", () => {
  const base = { session_id: "s", cwd: OPEN };
  const m = (agent, name, extra = {}) => mapHook(agent, { ...base, hook_event_name: name, ...extra }, CFG)?.event;
  assert.equal(m("claude", "UserPromptSubmit"), "working");
  assert.equal(m("claude", "Stop"), "idle");
  assert.equal(m("claude", "SessionEnd"), "end");
  assert.equal(m("claude", "Notification", { notification_type: "permission_prompt" }), "waiting");
  assert.equal(m("claude", "Notification", { notification_type: "idle_prompt" }), undefined);
  assert.equal(m("codex", "PermissionRequest"), "waiting");
  assert.equal(m("claude", "SomethingNew"), undefined);
  assert.equal(m("claude", "constructor"), undefined);
  const cursor = (roots, extra = {}) => mapHook("cursor", { hook_event_name: "afterFileEdit", conversation_id: "c1", workspace_roots: roots, file_path: path.join(OPEN, "a.ts"), ...extra }, CFG);
  const cur = cursor([OPEN]);
  assert.deepEqual({ e: cur.event, a: cur.activity, p: cur.project }, { e: "activity", a: "edit", p: "my-app" });
  assert.equal(cursor([OPEN, SECRET]), null, "a workspace with any private root reports nothing");
  assert.equal(cursor([OPEN], { cwd: SECRET }), null);
  assert.equal(cursor([]), null);
  assert.equal(mapHook("cursor", { hook_event_name: "stop", workspace_roots: [OPEN] }, CFG), null);
});

test("tool names map to activity kinds", () => {
  const cases = { Edit: "edit", Write: "edit", apply_patch: "edit", Bash: "command", shell: "command", Grep: "search", Glob: "search", Read: "read", WebFetch: "web", web_search: "web", Task: "subagent", Agent: "subagent", "": "think" };
  for (const [tool, want] of Object.entries(cases)) assert.equal(activityFor(tool), want, tool);
});

test("hooks merge without touching existing ones and remove cleanly", () => {
  const mine = { type: "command", command: "my-own-hook.sh" };
  const original = { model: "x", hooks: { Stop: [{ hooks: [mine] }], PreToolUse: [{ matcher: "Bash", hooks: [mine] }] } };
  const cmd = 'node "/home/u/.fantasy-agents/fa.mjs" hook claude';
  const added = addHooks(original, "claude", cmd);
  assert.equal(added.hooks.Stop.length, 2);
  assert.deepEqual(added.hooks.Stop[0], original.hooks.Stop[0]);
  assert.equal(added.hooks.SessionStart.length, 1);
  assert.deepEqual(addHooks(added, "claude", cmd), added, "idempotent");
  assert.deepEqual(removeHooks(added), original);
  assert.deepEqual(original.hooks.Stop.length, 1, "input not mutated");
});

test("cursor config gets a version and only non-blocking events", () => {
  const c = addHooks({}, "cursor", 'node "/h/.fantasy-agents/fa.mjs" hook cursor');
  assert.equal(c.version, 1);
  for (const ev of ["preToolUse", "beforeShellExecution", "beforeMCPExecution", "beforeReadFile", "subagentStart"]) assert.equal(c.hooks[ev], undefined);
  assert.deepEqual(removeHooks(c), { version: 1 });
});

// ------------------------------------------------ the real script, end to end

/** Run fa.mjs as the agent tools do, with a private home folder so the real config is never touched. */
function run(home, args, { stdin = "", cwd = tmp } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FA, ...args], { cwd, env: { ...process.env, HOME: home, USERPROFILE: home } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(stdin);
  });
}

async function village() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "application/json");
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { requests, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const readConfig = (home) => JSON.parse(fs.readFileSync(path.join(home, ".fantasy-agents", "config.json"), "utf8"));

test("hook: a session in a folder that is not allowed makes no network request", async () => {
  const v = await village();
  const home = dir("home-hook");
  fs.mkdirSync(path.join(home, ".fantasy-agents"), { recursive: true });
  const write = (projects) => fs.writeFileSync(path.join(home, ".fantasy-agents", "config.json"), JSON.stringify({ url: v.url, token: "tok", pc: "T", projects }));
  const fire = (cwd, session, name = "UserPromptSubmit") =>
    run(home, ["hook", "claude"], { stdin: JSON.stringify({ hook_event_name: name, session_id: session, cwd, prompt: "deploy the secret thing", tool_name: "Bash" }) });
  try {
    // freshly connected PC: nothing is allowed, so nothing is sent from anywhere
    write(undefined);
    for (const cwd of [OPEN, SECRET]) assert.equal((await fire(cwd, "s-new")).code, 0);
    assert.equal(v.requests.length, 0, "opt-in by default");

    write([{ path: OPEN, name: "alias-app" }]);
    for (const name of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Stop", "SessionEnd"]) {
      for (const cwd of [SECRET, LOOKALIKE, FOREIGN_TREE, tmp]) assert.equal((await fire(cwd, "s-private", name)).code, 0);
    }
    assert.equal(v.requests.length, 0, "private folders stay silent for every kind of event");

    await fire(OPEN_SUB, "s-open");
    await fire(WORKTREE, "s-tree");
    assert.equal(v.requests.length, 2);
    for (const r of v.requests) {
      assert.equal(r.url, "/api/events");
      assert.equal(r.auth, "Bearer tok");
      const ev = JSON.parse(r.body);
      assert.deepEqual(Object.keys(ev).sort(), ["agent", "event", "project", "session", "v"]);
      assert.equal(ev.project, "alias-app");
      for (const leak of ["my-app", "feature-x", "packages", "deploy", "s-open", "s-tree", path.basename(tmp)]) assert.ok(!r.body.includes(leak), leak);
    }
  } finally {
    await v.close();
  }
});

test("cli: allow, list, status and disallow manage the list without contacting the server", async () => {
  const v = await village();
  const home = dir("home-cli");
  try {
    // allowing before connecting only records the folder
    let r = await run(home, ["allow"], { cwd: OPEN });
    assert.match(r.out, /Allowed: /);
    assert.deepEqual(readConfig(home), { projects: [{ path: OPEN }] });

    fs.writeFileSync(path.join(home, ".fantasy-agents", "config.json"), JSON.stringify({ url: v.url, token: "tok", pc: "T", projects: [{ path: OPEN }] }));
    r = await run(home, ["allow", SECRET, "--as", "client work"]);
    assert.match(r.out, /shown as|see it as "client work"/);
    await run(home, ["allow", OPEN, "--as", "renamed"]);
    assert.deepEqual(readConfig(home).projects, [{ path: SECRET, name: "client work" }, { path: OPEN, name: "renamed" }], "re-allowing replaces the entry");

    r = await run(home, ["list"]);
    assert.ok(r.out.includes(OPEN) && r.out.includes('"renamed"') && r.out.includes('"client work"'), r.out);

    // the home folder is far too broad to allow without an explicit yes
    r = await run(home, ["allow", home]);
    assert.match(r.out, /Nothing was changed/);
    assert.equal(readConfig(home).projects.length, 2);

    r = await run(home, ["disallow"], { cwd: OPEN_SUB });
    assert.match(r.out, /is reported because/);
    assert.equal(readConfig(home).projects.length, 2);
    r = await run(home, ["disallow"], { cwd: SECRET });
    assert.match(r.out, /No longer reported/);
    assert.deepEqual(readConfig(home).projects, [{ path: OPEN, name: "renamed" }]);
    assert.equal(v.requests.length, 0, "editing the list sends nothing");

    r = await run(home, ["status"], { cwd: SECRET });
    assert.match(r.out, /Server check: ok/);
    assert.match(r.out, /This folder .*: not reported/);
    r = await run(home, ["status"], { cwd: WORKTREE });
    assert.match(r.out, /This folder .*: reported as "renamed"/);
    // status only pings: which tools have hooks, never the folder list
    assert.ok(v.requests.length && v.requests.every((q) => q.url === "/api/ping" && !q.body.includes("my-app") && !q.body.includes("renamed")));

    await run(home, ["disallow", "--all"]);
    assert.deepEqual(readConfig(home).projects, []);
    assert.equal(readConfig(home).token, "tok", "the connection itself is kept");
  } finally {
    await v.close();
  }
});
