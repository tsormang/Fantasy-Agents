import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pagesCode = compile("../web/src/pages.ts");
const domCode = compile("../web/src/dom.ts");
const namesContext = vm.createContext({ exports: {} });
vm.runInContext(compile("../shared/names.ts"), namesContext);

function loadPages(extra = {}, dom = {}) {
  const context = vm.createContext({ exports: {}, TextEncoder, btoa, ...extra,
    require: (name) => name === "./dom" ? dom : name === "../../shared/names" ? namesContext.exports : {},
  });
  vm.runInContext(pagesCode, context);
  return context.exports;
}

function runCommand(command, status = 0, options = {}) {
  assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
  const script = command.slice(9, -1);
  // No path characters can break the enclosing double quotes or trigger shell expansion.
  assert.doesNotMatch(script, /["`$%\r\n]/);
  const calls = [];
  const allowed = [];
  const stopped = new Error("exit");
  try {
    vm.runInNewContext(script, {
      Buffer,
      process: { execPath: "node", exit: (code) => { assert.equal(code, status); throw stopped; } },
      require: (name) => ({
        path,
        fs: {
          statSync: (p) => { if (options.missing === p) throw new Error("Missing folder"); return { isDirectory: () => true }; },
          realpathSync: (p) => p,
          readFileSync: () => JSON.stringify({ projects: allowed.map((path) => ({ path })) }),
        },
        os: { homedir: () => "/user home" },
        child_process: { spawnSync: (exe, args, spawnOptions) => { calls.push({ exe, args: Array.from(args), options: spawnOptions }); if (args[1] === "allow" && !options.cancel) allowed.push(path.resolve(args[2])); return { status }; } },
      })[name],
    });
  } catch (error) {
    if (error !== stopped) throw error;
  }
  return calls;
}

test("project command passes Windows, Unix and Unicode paths literally to the connector", () => {
  const paths = ["C:\\Web Projects\\App", "/home/you/Δοκιμή/🐉", "/tmp/a'b\"c$HOME`cmd`%PATH%&()\\"];
  const { projectsCommand } = loadPages();
  const calls = runCommand(projectsCommand(paths.map((path) => ({ path }))));
  assert.deepEqual(calls.map((call) => call.args), paths.map((p) => [path.join("/user home", ".fantasy-agents", "fa.mjs"), "allow", p]));
  assert.ok(calls.every((call) => call.exe === "node" && call.options.stdio === "inherit"));
});

test("project command passes optional display names literally using --as", () => {
  const { projectsCommand } = loadPages();
  const projects = [{ path: "C:\\Web Projects\\Lemnos", name: "Lemnos" }, { path: "/unnamed", name: "" }, { path: "/unicode", name: "Δοκιμή 🐉 ' \" $HOME `cmd` %PATH% &" }];
  const calls = runCommand(projectsCommand(projects));
  assert.deepEqual(calls.map((call) => call.args.slice(1)), projects.map((p) => ["allow", p.path, ...(p.name ? ["--as", p.name] : [])]));
});

test("project command stops if the connector cannot run", () => {
  const { projectsCommand } = loadPages();
  assert.equal(runCommand(projectsCommand([{ path: "/first" }, { path: "/second" }]), 1).length, 1);
});

test("editing renames and moves paths without removing retained or unrelated folders", () => {
  const { editProjectsCommand } = loadPages();
  const projects = [
    { path: "/new", previousPath: "/old", name: "New name 🐉 $HOME" },
    { path: "/same", previousPath: "/same", name: "Renamed" },
    { path: "/old", previousPath: "/another" },
  ];
  const calls = runCommand(editProjectsCommand(projects)).map((call) => call.args.slice(1));
  assert.deepEqual(calls, [["allow", "/new", "--as", projects[0].name], ["allow", "/same", "--as", "Renamed"], ["allow", "/old"], ["disallow", "/another"]]);
});

test("editing validates destinations before mutation and keeps old paths if allowance is declined", () => {
  const { editProjectsCommand } = loadPages();
  const command = editProjectsCommand([{ path: "/new", previousPath: "/old" }]);
  assert.throws(() => runCommand(command, 0, { missing: "/new" }), /Missing folder/);
  assert.throws(() => runCommand(command, 0, { cancel: true }), /old paths were kept/);
});

// Minimal DOM for checking the actual dialog's polling and form lifecycle.
class Element {
  children = [];
  value = "";
  textContent = "";
  classList = { toggle() {} };
  style = { setProperty() {} };
  append(...nodes) { for (const node of nodes) { node.remove?.(); this.children.push(node); node.parent = this; } }
  replaceChildren(...nodes) { this.children.forEach((node) => { node.parent = null; }); this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  querySelector(tag) { return this.all().find((node) => node.tag === tag); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  focus() {}
  setAttribute(name, value) { this[name] = value; }
  get firstChild() { return this.children[0]; }
}

test("project fields generate multiple paths and survive status polling and PC switching", async () => {
  const document = { createElement: (tag) => Object.assign(new Element(), { tag }) };
  const domContext = vm.createContext({ exports: {}, document });
  vm.runInContext(domCode, domContext);
  let poll;
  const devices = ["first", "second"].map((id) => ({ id, name: id, owner: "Owner", reported: 1, proto: 2, agents: [] }));
  const requests = [];
  const dom = { ...domContext.exports, api: async (...args) => { requests.push(args); return { devices, now: 1000 }; }, copyButton: () => Object.assign(new Element(), { tag: "button", textContent: "Copy" }) };
  const pages = loadPages({
    window: { setInterval: (fn) => { poll = fn; return 1; } },
    localStorage: { getItem: () => "first" },
    location: { origin: "https://example.com" },
  }, dom);
  const root = new Element();
  await pages.connectModal(root);
  const find = (text) => root.all().find((node) => node.textContent === text);
  assert.ok(find("Step 1: Connect PC"));
  assert.ok(find("Step 2: Connect Agents"));
  const first = root.querySelector("input");
  first.value = "C:\\Projects\\First";
  first.oninput();
  const firstCategory = root.querySelector("select");
  firstCategory.value = "latin";
  firstCategory.onchange();
  find("+ Add project path").onclick();
  const second = root.all().filter((node) => node.tag === "input")[1];
  second.value = "/projects/second";
  second.oninput();
  const command = () => root.all().find((node) => node.className === "cmd grow" && node.textContent.startsWith('node -e "const f='));
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args[2]), [first.value, second.value]);
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args.slice(3)), [["--as", "@names:latin"], ["--as", "@names:fantasy"]]);
  poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.querySelector("input"), first);
  assert.equal(first.value, "C:\\Projects\\First");
  assert.equal(firstCategory.value, "latin");
  root.all().filter((node) => node.textContent === "Test")[1].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.querySelector("input").value, "");
  find("Test").onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.querySelector("input"), first);
  firstCategory.value = "korean";
  firstCategory.onchange();
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args.slice(3)), [["--as", "@names:korean"], ["--as", "@names:fantasy"]]);
  find("Remove").onclick();
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args[2]), [second.value]);
  assert.ok(requests.every(([url]) => url === "/devices"), "Paths must not be submitted to the server");
});

test("selecting your resting hero offers removal, while working, foreign and spectator heroes do not", async () => {
  const document = { createElement: (tag) => Object.assign(new Element(), { tag }) };
  const domContext = vm.createContext({ exports: {}, document });
  vm.runInContext(domCode, domContext);
  const requests = [];
  const context = vm.createContext({ exports: {}, window: { innerWidth: 1000 }, setInterval() {},
    require: (name) => ({
      "./dom": { ...domContext.exports, api: async (...args) => { requests.push(args); return { ok: true }; } },
      "./game/describe": { describe: () => "Resting" },
      "./resize": { observeSize() {} },
    })[name],
  });
  vm.runInContext(compile("../web/src/hud.ts"), context);
  const base = { agent: "codex", pc: "My PC", owner: "Member", ownerId: "me", status: "idle", since: 0, name: "Aurelius" };
  const agents = [
    { ...base, id: "my:rest" },
    { ...base, id: "my:work", status: "working" },
    { ...base, id: "their:rest", ownerId: "someone-else" },
  ];
  const store = { memberId: "me", agents: new Map(agents.map((a) => [a.id, a])), now: () => 1000, onChange() {}, emit() {} };
  const game = { select() {} };
  const root = new Element();
  new context.exports.Hud(root, store, game, { portrait: () => new Element(), classLabel: () => "Mage" });
  const panel = root.all().find((node) => node.className === "agent-actions box");
  game.onSelect("my:work");
  assert.equal(panel.hidden, true);
  game.onSelect("their:rest");
  assert.equal(panel.hidden, true);
  store.memberId = null;
  game.onSelect("my:rest");
  assert.equal(panel.hidden, true);
  store.memberId = "me";
  game.onSelect("my:rest");
  assert.equal(panel.hidden, false);
  const remove = panel.all().find((node) => node.textContent === "Remove resting agent");
  await remove.onclick();
  assert.deepEqual(requests, [["/agents/my%3Arest", "DELETE"]]);
  assert.equal(store.agents.has("my:rest"), false);
  assert.equal(panel.hidden, true);
});

test("Edit tab lists only owned PCs and imports paths locally without uploading credentials", async () => {
  const document = { createElement: (tag) => Object.assign(new Element(), { tag }) };
  const domContext = vm.createContext({ exports: {}, document });
  vm.runInContext(domCode, domContext);
  let poll;
  const devices = [
    { id: "mine", name: "My PC", editable: true },
    { id: "other", name: "Someone else's PC", editable: false },
  ].map((d) => ({ ...d, owner: "Owner", reported: 1, proto: 2, agents: [] }));
  const requests = [];
  const dom = { ...domContext.exports, api: async (...args) => { requests.push(args); return { devices, now: 1000 }; }, copyButton: () => new Element() };
  const pages = loadPages({
    window: { setInterval: (fn) => { poll = fn; return 1; } },
    localStorage: { getItem: () => "mine" }, location: { origin: "https://example.com" },
  }, dom);
  const root = new Element();
  await pages.connectModal(root, "edit");
  const find = (text) => root.all().find((node) => node.textContent === text);
  const editDevices = root.all().find((node) => node.className === "edit-devices");
  assert.deepEqual(editDevices.children.map((node) => node.textContent), ["My PC"]);
  const file = root.all().find((node) => node.type === "file");
  file.files = [{ text: async () => JSON.stringify({ token: "never-upload-this", projects: [{ path: "/old", name: "Old name" }] }) }];
  await file.onchange();
  const editPanel = root.all().find((node) => node.textContent === "Edit your agents").parent;
  const inputs = editPanel.all().filter((node) => node.type === "text");
  assert.deepEqual(inputs.map((node) => node.value), ["/old", ""]);
  const category = editPanel.querySelector("select");
  assert.equal(category.value, "fantasy");
  inputs[1].value = "/new";
  category.value = "ancient-greek";
  category.onchange();
  const command = editPanel.all().find((node) => node.tag === "code").textContent;
  assert.deepEqual(runCommand(command).map((call) => call.args.slice(1)), [["allow", "/new", "--as", "@names:ancient-greek"], ["disallow", "/old"]]);
  assert.ok(!command.includes("never-upload-this"));
  find("Connect").onclick();
  find("Edit").onclick();
  poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(editPanel.all().find((node) => node.type === "text"), inputs[0]);
  assert.equal(category.value, "ancient-greek");
  assert.ok(requests.every(([url, method, body]) => url === "/devices" && !method && !body));
});
