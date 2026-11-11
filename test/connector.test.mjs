import assert from "node:assert/strict";
import { test } from "node:test";
import { activityFor, addHooks, mapHook, removeHooks } from "../connector/fa.mjs";

test("privacy: only allow-listed fields leave the machine", () => {
  const ev = mapHook("claude", {
    hook_event_name: "PreToolUse",
    session_id: "abc-123",
    cwd: "C:\\Users\\me\\secret-client\\my-app\\",
    tool_name: "Bash",
    tool_input: { command: "curl -H 'Authorization: token hunter2' https://internal" },
    prompt: "top secret prompt",
    transcript_path: "C:\\Users\\me\\.claude\\x.jsonl",
  });
  assert.deepEqual(Object.keys(ev).sort(), ["activity", "agent", "event", "project", "session", "v"]);
  assert.equal(ev.project, "my-app");
  assert.equal(ev.activity, "command");
  assert.match(ev.session, /^[0-9a-f]{16}$/);
  const wire = JSON.stringify(ev);
  for (const leak of ["hunter2", "secret", "abc-123", "Users"]) assert.ok(!wire.includes(leak), leak);
});

test("event mapping per agent", () => {
  const base = { session_id: "s", cwd: "/home/u/proj" };
  const m = (agent, name, extra = {}) => mapHook(agent, { ...base, hook_event_name: name, ...extra })?.event;
  assert.equal(m("claude", "UserPromptSubmit"), "working");
  assert.equal(m("claude", "Stop"), "idle");
  assert.equal(m("claude", "SessionEnd"), "end");
  assert.equal(m("claude", "Notification", { notification_type: "permission_prompt" }), "waiting");
  assert.equal(m("claude", "Notification", { notification_type: "idle_prompt" }), undefined);
  assert.equal(m("codex", "PermissionRequest"), "waiting");
  assert.equal(m("claude", "SomethingNew"), undefined);
  const cur = mapHook("cursor", { hook_event_name: "afterFileEdit", conversation_id: "c1", workspace_roots: ["/w/site"], file_path: "/w/site/a.ts" });
  assert.deepEqual({ e: cur.event, a: cur.activity, p: cur.project }, { e: "activity", a: "edit", p: "site" });
  assert.equal(mapHook("cursor", { hook_event_name: "stop" }), null);
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
