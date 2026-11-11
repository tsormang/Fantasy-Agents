#!/usr/bin/env node
// Fantasy Agents connector. Zero dependencies, Node 18+.
//
//   node fa.mjs connect <url> <pairing-code> [--name "My PC"] [--only claude,codex,cursor] [--yes]
//   node fa.mjs status
//   node fa.mjs disconnect [--yes]
//   node fa.mjs hook <claude|codex|cursor>     (called by the agent tools, reads hook JSON on stdin)
//
// Privacy: the hook sends ONLY { agent, hashed session id, event, activity kind, project folder name }.
// Prompts, commands, file paths and file contents never leave this machine.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const DIR = path.join(HOME, ".fantasy-agents");
const CONFIG = path.join(DIR, "config.json");
const SCRIPT = path.join(DIR, "fa.mjs");
const MARK = ".fantasy-agents";

// ------------------------------------------------------------------ mapping

/** Tool name -> activity kind. Only the kind is sent, never the tool input. */
export function activityFor(tool) {
  const t = String(tool || "").toLowerCase();
  if (!t) return "think";
  if (/web|fetch|browser|http|url/.test(t)) return "web";
  if (/task|agent/.test(t)) return "subagent";
  if (/edit|write|patch|notebook|create|delete/.test(t)) return "edit";
  if (/bash|shell|exec|powershell|terminal|command|mcp/.test(t)) return "command";
  if (/grep|glob|search|find|list|ls/.test(t)) return "search";
  if (/read|view|open|cat/.test(t)) return "read";
  return "think";
}

const CLAUDE_LIKE = {
  SessionStart: () => ({ event: "start" }),
  UserPromptSubmit: () => ({ event: "working" }),
  PreToolUse: (i) => ({ event: "activity", activity: activityFor(i.tool_name) }),
  PostToolUse: () => ({ event: "activity", activity: "think" }),
  PermissionRequest: () => ({ event: "waiting" }),
  Notification: (i) => (i.notification_type === "permission_prompt" ? { event: "waiting" } : null),
  SubagentStart: () => ({ event: "activity", activity: "subagent" }),
  Stop: () => ({ event: "idle" }),
  SessionEnd: () => ({ event: "end" }),
};

const CURSOR = {
  sessionStart: () => ({ event: "start" }),
  beforeSubmitPrompt: () => ({ event: "working" }),
  postToolUse: (i) => ({ event: "activity", activity: activityFor(i.tool_name) }),
  afterFileEdit: () => ({ event: "activity", activity: "edit" }),
  afterShellExecution: () => ({ event: "activity", activity: "command" }),
  afterMCPExecution: () => ({ event: "activity", activity: "command" }),
  stop: () => ({ event: "idle" }),
  sessionEnd: () => ({ event: "end" }),
};

const hashId = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

/** Turn a raw hook payload into the wire event. Returns null when there is nothing to report. */
export function mapHook(agent, input) {
  if (!input || typeof input !== "object") return null;
  const table = agent === "cursor" ? CURSOR : CLAUDE_LIKE;
  const fn = table[input.hook_event_name];
  const mapped = fn ? fn(input) : null;
  if (!mapped) return null;
  const session = input.session_id || input.conversation_id;
  if (!session) return null;
  const root = input.cwd || (Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : "") || "";
  const out = { v: 1, agent, session: hashId(session), ...mapped };
  const project = path.basename(String(root).replace(/[\\/]+$/, ""));
  if (project) out.project = project.slice(0, 40);
  return out;
}

// --------------------------------------------------------------- hook files

const hookCmd = (agent) => `node "${SCRIPT}" hook ${agent}`;
const isOurs = (cmd) => typeof cmd === "string" && cmd.includes(MARK) && cmd.includes("fa.mjs");

export const AGENTS = {
  claude: {
    label: "Claude Code",
    dir: path.join(HOME, ".claude"),
    file: path.join(HOME, ".claude", "settings.json"),
    events: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "SubagentStart", "Stop", "SessionEnd"],
    entry: (cmd) => ({ hooks: [{ type: "command", command: cmd, timeout: 5, async: true }] }),
    note: "",
  },
  codex: {
    label: "Codex",
    dir: path.join(HOME, ".codex"),
    file: path.join(HOME, ".codex", "hooks.json"),
    events: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "SubagentStart", "Stop", "SessionEnd"],
    entry: (cmd) => ({ hooks: [{ type: "command", command: cmd, timeout: 5 }] }),
    note: "Codex skips new hooks until you trust them: Settings > Hooks in the desktop app, or /hooks in the CLI",
  },
  cursor: {
    label: "Cursor",
    dir: path.join(HOME, ".cursor"),
    file: path.join(HOME, ".cursor", "hooks.json"),
    // Only after-the-fact events: Cursor's before*/preToolUse hooks can block actions, so we stay out of them.
    events: ["sessionStart", "beforeSubmitPrompt", "postToolUse", "afterFileEdit", "afterShellExecution", "afterMCPExecution", "stop", "sessionEnd"],
    entry: (cmd) => ({ command: cmd, timeout: 5 }),
    note: "",
  },
};

const entryIsOurs = (e) => isOurs(e?.command) || (Array.isArray(e?.hooks) && e.hooks.some((h) => isOurs(h?.command)));

/** Remove every entry this connector added; leaves everything else untouched. */
export function removeHooks(config) {
  const out = structuredClone(config ?? {});
  if (!out.hooks || typeof out.hooks !== "object") return out;
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue;
    out.hooks[ev] = out.hooks[ev].filter((e) => !entryIsOurs(e));
    if (!out.hooks[ev].length) delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

/** Add our entries next to whatever hooks already exist. Idempotent. */
export function addHooks(config, agent, cmd = hookCmd(agent)) {
  const spec = AGENTS[agent];
  const out = removeHooks(config);
  if (agent === "cursor" && out.version === undefined) out.version = 1;
  out.hooks ??= {};
  for (const ev of spec.events) (out.hooks[ev] ??= []).push(spec.entry(cmd));
  return out;
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  return text.trim() ? JSON.parse(text) : {};
}

function writeHooks(agent, transform) {
  const spec = AGENTS[agent];
  let current;
  try {
    current = readJson(spec.file);
  } catch {
    console.log(`  ! ${spec.label}: ${spec.file} is not valid JSON, leaving it untouched.`);
    return false;
  }
  const next = transform(current);
  if (JSON.stringify(next) === JSON.stringify(current)) return true;
  if (fs.existsSync(spec.file)) {
    const backup = `${spec.file}.fa-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(spec.file, backup);
    console.log(`  backup: ${backup}`);
  }
  if (!Object.keys(next).length && agent !== "claude") fs.rmSync(spec.file, { force: true });
  else fs.writeFileSync(spec.file, JSON.stringify(next, null, 2) + "\n");
  return true;
}

const installed = (agent) => {
  try {
    const h = readJson(AGENTS[agent].file).hooks ?? {};
    return Object.values(h).some((list) => Array.isArray(list) && list.some(entryIsOurs));
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------- CLI

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return null;
  }
};

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--yes" || argv[i] === "-y") out.yes = true;
    else if (argv[i] === "--name") out.name = argv[++i];
    else if (argv[i] === "--only") out.only = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.log(`${question} (not a terminal: re-run with --yes to proceed)`);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`${question} [y/N] `, r));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function connect(argv) {
  const f = flags(argv);
  const [rawUrl, code] = f._;
  if (!rawUrl || !code) return console.log('Usage: node fa.mjs connect <url> <pairing-code> [--name "My PC"] [--only claude,codex,cursor] [--yes]');
  const url = rawUrl.replace(/\/+$/, "");
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(url);
  if (!url.startsWith("https://") && !local) return console.log("The village URL must start with https://");
  const only = f.only ? f.only.split(",") : Object.keys(AGENTS);
  const targets = Object.keys(AGENTS).filter((a) => only.includes(a) && fs.existsSync(AGENTS[a].dir));
  const pc = (f.name || os.hostname()).slice(0, 24);

  console.log(`\nFantasy Agents will connect this PC as "${pc}" to ${url}\n`);
  if (!targets.length) console.log("No supported agent tools found (looked for ~/.claude, ~/.codex, ~/.cursor).");
  for (const a of targets) console.log(`  - ${AGENTS[a].label}: add hooks to ${AGENTS[a].file} (existing hooks are kept, a backup is made)`);
  console.log(`  - save the connector and a device token in ${DIR}`);
  console.log("\nIt sends only: agent type, project folder name and activity kind. Never prompts, commands or code.\n");
  if (!(await confirm("Proceed?", f.yes))) return console.log("Nothing was changed.");

  const res = await fetch(`${url}/api/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, pc, agents: targets }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return console.log(`Could not connect: ${data.error || res.status}`);

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ url, token: data.token, pc: data.pc, deviceId: data.deviceId }, null, 2), { mode: 0o600 });
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(self) !== path.resolve(SCRIPT)) fs.copyFileSync(self, SCRIPT);

  for (const a of targets) {
    if (writeHooks(a, (c) => addHooks(c, a))) console.log(`  ok: ${AGENTS[a].label}${AGENTS[a].note ? ` (${AGENTS[a].note})` : ""}`);
  }
  console.log(`\nConnected. Server check: ${await ping()}`);
  console.log("Now go back to the web page: it shows a checklist to test each agent.");
  console.log("Start a NEW session in each tool and send any prompt; running sessions do not pick up hooks.");
  console.log(`To undo everything: node "${SCRIPT}" disconnect\n`);
}

async function disconnect(argv) {
  const f = flags(argv);
  if (!(await confirm("Remove Fantasy Agents hooks and the saved device token from this PC?", f.yes))) return console.log("Nothing was changed.");
  for (const a of Object.keys(AGENTS)) {
    if (fs.existsSync(AGENTS[a].file) && installed(a) && writeHooks(a, removeHooks)) console.log(`  removed hooks: ${AGENTS[a].label}`);
  }
  fs.rmSync(CONFIG, { force: true });
  console.log("Done. To revoke this PC on the server too, use Connect PC > Revoke on the web page.");
  console.log(`You can now delete ${DIR}`);
}

async function ping() {
  const cfg = loadConfig();
  if (!cfg) return "not connected";
  try {
    const res = await fetch(`${cfg.url}/api/ping`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(5000) });
    if (res.ok) return "ok";
    return res.status === 401 ? "this PC was revoked on the server; run connect again" : `server answered ${res.status}`;
  } catch {
    return "could not reach the server (offline, proxy or firewall?)";
  }
}

async function status() {
  const cfg = loadConfig();
  console.log(cfg ? `Connected as "${cfg.pc}" to ${cfg.url}` : "Not connected.");
  if (cfg) console.log(`  Server check: ${await ping()}`);
  for (const a of Object.keys(AGENTS)) {
    const spec = AGENTS[a];
    console.log(`  ${spec.label}: ${!fs.existsSync(spec.dir) ? "not installed" : installed(a) ? "hooks installed" : "no hooks"}`);
  }
}

// --------------------------------------------------------------------- hook

function throttled(ev) {
  // Collapse bursts of tool calls: at most one activity event every 2 s per session.
  if (ev.event !== "activity") return false;
  const file = path.join(os.tmpdir(), `fa-${ev.session}.json`);
  const now = Date.now();
  try {
    const last = JSON.parse(fs.readFileSync(file, "utf8"));
    if (now - last.t < 2000 && last.activity === ev.activity) return true;
  } catch {
    /* first event */
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ t: now, activity: ev.activity }));
  } catch {
    /* best effort */
  }
  return false;
}

async function hook(agent) {
  // A hook must never block or fail the agent: every path ends in exit code 0.
  try {
    let raw = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 5_000_000) break;
    }
    const input = JSON.parse(raw.replace(/^﻿/, ""));
    if (agent === "cursor" && input.hook_event_name === "beforeSubmitPrompt") process.stdout.write('{"continue":true}\n');
    const cfg = loadConfig();
    const ev = mapHook(agent, input);
    if (!cfg || !ev || throttled(ev)) return;
    await fetch(`${cfg.url}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* offline or malformed input: stay silent */
  }
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "hook") {
    await hook(rest[0]);
    process.exit(0);
  } else if (cmd === "connect") await connect(rest);
  else if (cmd === "disconnect") await disconnect(rest);
  else if (cmd === "status") await status();
  else console.log("Fantasy Agents connector\n  node fa.mjs connect <url> <pairing-code>\n  node fa.mjs status\n  node fa.mjs disconnect");
}
