#!/usr/bin/env node
// Fantasy Agents connector. Zero dependencies, Node 18+.
//
//   node fa.mjs connect <url> <pairing-code> [--name "My PC"] [--only claude,codex,cursor] [--yes]
//   node fa.mjs allow [folder] [--as "shown name"]   report agent sessions in this folder (default: current folder)
//   node fa.mjs disallow [folder] | --all            stop reporting a folder
//   node fa.mjs list                                 folders that are reported
//   node fa.mjs status
//   node fa.mjs update                               fetch the newest connector from the village
//   node fa.mjs disconnect [--yes]
//   node fa.mjs hook <claude|codex|cursor>           (called by the agent tools, reads hook JSON on stdin)
//
// Privacy: nothing is sent unless the session runs in a folder you allowed. The allow-list lives in
// ~/.fantasy-agents/config.json and is checked here, on this machine; folder paths are never sent.
// For an allowed folder the hook sends ONLY { agent, keyed session hash, event, activity kind, shown name }.
// Prompts, commands, file paths and file contents never leave this machine.

import { createHmac } from "node:crypto";
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
/** Wire format version. v1 connectors reported every folder; the server refuses them. */
const PROTO = 2;

const clean = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

// ------------------------------------------------------------- allow-list

const FOLD = process.platform === "win32" || process.platform === "darwin";
const fold = (p) => (FOLD ? p.toLowerCase() : p);

/** Absolute, symlink-free form of a folder path, or null when it is not an absolute path. */
function canon(p) {
  let s = String(p ?? "");
  // some tools report Windows folders as /c:/Users/...
  if (process.platform === "win32" && /^\/[A-Za-z]:[\\/]/.test(s)) s = s.slice(1);
  if (!path.isAbsolute(s)) return null;
  s = path.resolve(s);
  try {
    s = fs.realpathSync.native(s);
  } catch {
    /* folder is gone: compare by name */
  }
  return s;
}

const within = (child, parent) => {
  const c = fold(child);
  const p = fold(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

/** If `dir` is inside a linked git worktree, the same folder inside the main checkout. Reads only local files. */
function worktreeTwin(dir) {
  let d = dir;
  for (let i = 0; i < 64; i++) {
    const dotGit = path.join(d, ".git");
    let st = null;
    try {
      st = fs.statSync(dotGit);
    } catch {
      /* keep walking up */
    }
    if (st) {
      if (!st.isFile()) return null; // an ordinary checkout
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, "utf8"));
      const w = m && /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.exec(path.resolve(d, m[1]));
      const main = w && canon(w[1]);
      return main ? path.join(main, path.relative(d, dir)) : null;
    }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

/**
 * The allow-list entry that covers `folder`: the folder itself, a subfolder, or a git worktree of an
 * allowed folder. Returns null when the folder is not allowed, which means: send nothing.
 */
export function projectFor(folder, projects) {
  if (typeof folder !== "string" || !folder || !Array.isArray(projects)) return null;
  const list = projects.filter((p) => p && typeof p.path === "string" && path.isAbsolute(p.path));
  if (!list.length) return null;
  const find = (d) =>
    list.filter((p) => within(d, path.resolve(p.path))).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
  try {
    const dir = canon(folder);
    if (!dir) return null;
    const hit = find(dir);
    if (hit) return hit;
    const twin = worktreeTwin(dir);
    return twin ? find(twin) : null;
  } catch {
    return null;
  }
}

/** What viewers see for an allowed folder: its alias, or else the folder's own name. Never a path. */
export const projectName = (p) => clean(p.name, 40) || clean(path.basename(p.path), 40) || "project";

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

/** Keyed with this PC's device token, so the id cannot be recomputed or matched by anyone who knows a session id. */
const hashId = (session, key) => createHmac("sha256", String(key)).update(String(session)).digest("hex").slice(0, 16);

/**
 * Turn a raw hook payload into the wire event. Returns null when there is nothing to report, and in
 * particular whenever the session's folder is not on this PC's allow-list (`cfg.projects`).
 */
export function mapHook(agent, input, cfg) {
  if (!input || typeof input !== "object" || !cfg || !cfg.token) return null;
  const table = agent === "cursor" ? CURSOR : CLAUDE_LIKE;
  const fn = Object.hasOwn(table, input.hook_event_name) ? table[input.hook_event_name] : null;
  const mapped = fn ? fn(input) : null;
  if (!mapped) return null;
  const session = input.session_id || input.conversation_id;
  if (!session) return null;
  // Every folder the session is tied to must be allowed. No folder information means: cannot tell, send nothing.
  const folders = [input.cwd, ...(Array.isArray(input.workspace_roots) ? input.workspace_roots : [])].filter(Boolean);
  if (!folders.length) return null;
  const hits = folders.map((f) => projectFor(f, cfg.projects));
  if (hits.some((h) => !h)) return null;
  return { v: PROTO, agent, session: hashId(session, cfg.token), ...mapped, project: projectName(hits[0]) };
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
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
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
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8").replace(/^\uFEFF/, ""));
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch {
    return null;
  }
};

/** Hooks read this file while we write it, so replace it in one step. */
function saveConfig(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  const text = JSON.stringify(cfg, null, 2) + "\n";
  const tmp = `${CONFIG}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, CONFIG);
  } catch {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(CONFIG, text, { mode: 0o600 });
  }
}

const projectsOf = (cfg) => (Array.isArray(cfg?.projects) ? cfg.projects.filter((p) => p && typeof p.path === "string") : []);
const self = () => `node "${SCRIPT}"`;

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--yes" || argv[i] === "-y") out.yes = true;
    else if (argv[i] === "--all") out.all = true;
    else if (argv[i] === "--name") out.name = argv[++i];
    else if (argv[i] === "--only") out.only = argv[++i];
    else if (argv[i] === "--as") out.as = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  return answer.trim();
}

async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.log(`${question} (not a terminal: re-run with --yes to proceed)`);
    return false;
  }
  return /^y(es)?$/i.test(await ask(`${question} [y/N] `));
}

/** Home and drive roots would expose every project under them, so they need an explicit yes. */
const tooBroad = (dir) => path.dirname(dir) === dir || within(canon(HOME) ?? HOME, dir);

function printProjects(cfg) {
  const list = projectsOf(cfg);
  if (!list.length) {
    console.log("  Reported folders: none. Nothing is sent from this PC.");
    console.log(`  To show a project on the battlefield, run this inside its folder: ${self()} allow`);
    return;
  }
  console.log(`  Reported folders (${list.length}), with their subfolders and git worktrees:`);
  for (const p of list) console.log(`    ${p.path}  ->  shown as "${projectName(p)}"`);
  console.log("  Sessions in any other folder send nothing.");
}

async function allow(argv) {
  const f = flags(argv);
  const dir = canon(path.resolve(f._[0] || process.cwd()));
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {
    /* missing */
  }
  if (!isDir) return console.log(`Not a folder: ${f._[0] || process.cwd()}`);
  if (tooBroad(dir) && !(await confirm(`${dir} contains your whole home folder or drive: every project under it would be reported. Allow it anyway?`, f.yes)))
    return console.log("Nothing was changed.");
  const cfg = loadConfig() ?? {};
  const entry = { path: dir };
  const alias = clean(f.as, 40);
  if (alias) entry.name = alias;
  const projects = projectsOf(cfg).filter((p) => fold(path.resolve(p.path)) !== fold(dir));
  projects.push(entry);
  saveConfig({ ...cfg, projects });
  console.log(`Allowed: ${dir}`);
  console.log(`  Viewers see it as "${projectName(entry)}"${alias ? "" : ` (the folder name; hide it with: ${self()} allow --as "an alias")`}.`);
  console.log("  Its subfolders and git worktrees are included. The path itself is never sent.");
  const twin = worktreeTwin(dir);
  if (twin) console.log(`  Note: this is a git worktree of ${twin}. Allow that folder instead to cover all of its worktrees.`);
  if (!cfg.token) console.log("  This PC is not connected yet, so nothing is sent until you run connect.");
}

function disallow(argv) {
  const f = flags(argv);
  const cfg = loadConfig();
  const list = projectsOf(cfg);
  if (!cfg || !list.length) return console.log("No folders are allowed. Nothing is sent from this PC.");
  if (f.all) {
    saveConfig({ ...cfg, projects: [] });
    return console.log("Removed every allowed folder. Nothing is sent from this PC now.");
  }
  const dir = canon(path.resolve(f._[0] || process.cwd()));
  const rest = list.filter((p) => fold(path.resolve(p.path)) !== fold(dir));
  if (rest.length === list.length) {
    const cover = projectFor(dir, list);
    return console.log(
      cover ? `${dir} is reported because ${cover.path} is allowed. To stop that: ${self()} disallow "${cover.path}"` : `${dir} was not allowed; nothing is sent from it.`,
    );
  }
  saveConfig({ ...cfg, projects: rest });
  console.log(`No longer reported: ${dir}`);
  const cover = projectFor(dir, rest);
  if (cover) console.log(`  Careful: it is still covered by ${cover.path}, which is allowed.`);
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
  const interactive = !f.yes && process.stdin.isTTY;
  let name = f.name;
  // The computer's own name can identify an employer, so it is a suggestion, not a given.
  if (!name && interactive) name = await ask(`\nName for this PC, shown to everyone who can watch the village [${os.hostname()}]: `);
  const pc = clean(name || os.hostname(), 24);

  console.log(`\nFantasy Agents will connect this PC as "${pc}" to ${url}\n`);
  if (!targets.length) console.log("No supported agent tools found (looked for ~/.claude, ~/.codex, ~/.cursor).");
  for (const a of targets) console.log(`  - ${AGENTS[a].label}: add hooks to ${AGENTS[a].file} (existing hooks are kept, a backup is made)`);
  console.log(`  - save the connector and a device token in ${DIR}`);
  console.log("\nNothing is reported until you allow a project folder. For allowed folders it sends only:");
  console.log("agent type, the folder's name or your alias, and an activity kind. Never prompts, commands, paths or code.\n");
  if (!(await confirm("Proceed?", f.yes))) return console.log("Nothing was changed.");

  const res = await fetch(`${url}/api/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: PROTO, code, pc, agents: targets }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return console.log(`Could not connect: ${data.error || res.status}`);

  // folders allowed before (re)connecting stay allowed
  let cfg = { url, token: data.token, pc: data.pc, deviceId: data.deviceId, projects: projectsOf(loadConfig()) };
  saveConfig(cfg);
  const me = fileURLToPath(import.meta.url);
  if (path.resolve(me) !== path.resolve(SCRIPT)) fs.copyFileSync(me, SCRIPT);

  for (const a of targets) {
    if (writeHooks(a, (c) => addHooks(c, a))) console.log(`  ok: ${AGENTS[a].label}${AGENTS[a].note ? ` (${AGENTS[a].note})` : ""}`);
  }
  console.log(`\nConnected. Server check: ${await ping()}`);

  const here = canon(process.cwd());
  if (interactive && here && !tooBroad(here) && !projectFor(here, cfg.projects)) {
    if (await confirm(`\nReport agent sessions that run in the current folder (${here})?`)) {
      cfg = { ...cfg, projects: [...cfg.projects, { path: here }] };
      saveConfig(cfg);
    }
  }
  console.log("");
  printProjects(cfg);
  console.log("\nNow go back to the web page: it shows a checklist to test each agent.");
  console.log("Start a NEW session in each tool, inside an allowed folder, and send any prompt; running sessions do not pick up hooks.");
  console.log(`To undo everything: ${self()} disconnect\n`);
}

async function disconnect(argv) {
  const f = flags(argv);
  if (!(await confirm("Remove Fantasy Agents hooks, the saved device token and the allowed-folder list from this PC?", f.yes))) return console.log("Nothing was changed.");
  for (const a of Object.keys(AGENTS)) {
    if (fs.existsSync(AGENTS[a].file) && installed(a) && writeHooks(a, removeHooks)) console.log(`  removed hooks: ${AGENTS[a].label}`);
  }
  fs.rmSync(CONFIG, { force: true });
  console.log("Done. To revoke this PC on the server too, use Connect PC > Revoke on the web page.");
  console.log(`You can now delete ${DIR}`);
}

async function ping() {
  const cfg = loadConfig();
  if (!cfg?.token) return "not connected";
  try {
    const res = await fetch(`${cfg.url}/api/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
      // tell the server which tools have our hooks, so its checklist is accurate
      body: JSON.stringify({ v: PROTO, agents: Object.keys(AGENTS).filter(installed) }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return "ok";
    return res.status === 401 ? "this PC was revoked on the server; run connect again" : `server answered ${res.status}`;
  } catch {
    return "could not reach the server (offline, proxy or firewall?)";
  }
}

async function status() {
  const cfg = loadConfig();
  console.log(cfg?.token ? `Connected as "${cfg.pc}" to ${cfg.url}` : "Not connected.");
  if (cfg?.token) console.log(`  Server check: ${await ping()}`);
  printProjects(cfg);
  const here = canon(process.cwd());
  const hit = here && projectFor(here, projectsOf(cfg));
  console.log(`  This folder (${here}): ${hit ? `reported as "${projectName(hit)}"` : "not reported"}`);
  for (const a of Object.keys(AGENTS)) {
    const spec = AGENTS[a];
    console.log(`  ${spec.label}: ${!fs.existsSync(spec.dir) ? "not installed" : installed(a) ? "hooks installed" : "no hooks"}`);
  }
}

/** Replace the installed connector with the one the village serves. The hooks already point at it. */
async function update() {
  const cfg = loadConfig();
  if (!cfg?.url) return console.log("Not connected, so there is no village to update from.");
  const res = await fetch(`${cfg.url}/fa.mjs`, { signal: AbortSignal.timeout(10_000) });
  const text = res.ok ? await res.text() : "";
  if (!text.startsWith("#!/usr/bin/env node") || !text.includes("Fantasy Agents connector")) return console.log(`Could not download the connector from ${cfg.url}/fa.mjs`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(SCRIPT, text);
  console.log(`Updated ${SCRIPT}. Run "${self()} status" to see what this PC reports.`);
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
    const input = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (agent === "cursor" && input.hook_event_name === "beforeSubmitPrompt") process.stdout.write('{"continue":true}\n');
    const cfg = loadConfig();
    // mapHook returns null for any folder that is not allowed: then nothing at all is sent or written.
    const ev = cfg?.url ? mapHook(agent, input, cfg) : null;
    if (!ev || throttled(ev)) return;
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
  else if (cmd === "allow") await allow(rest);
  else if (cmd === "disallow") disallow(rest);
  else if (cmd === "list") printProjects(loadConfig());
  else if (cmd === "update") await update();
  else
    console.log(
      [
        "Fantasy Agents connector",
        "  node fa.mjs connect <url> <pairing-code>",
        '  node fa.mjs allow [folder] [--as "shown name"]   report sessions in a folder (default: the current one)',
        "  node fa.mjs disallow [folder] | --all",
        "  node fa.mjs list",
        "  node fa.mjs status",
        "  node fa.mjs update",
        "  node fa.mjs disconnect",
      ].join("\n"),
    );
}
