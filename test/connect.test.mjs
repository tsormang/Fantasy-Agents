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

function loadPages(extra = {}, dom = {}) {
  const context = vm.createContext({ exports: {}, TextEncoder, btoa, ...extra,
    require: (name) => name === "./dom" ? dom : {},
  });
  vm.runInContext(pagesCode, context);
  return context.exports;
}

function runCommand(command, status = 0) {
  assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
  const script = command.slice(9, -1);
  // No path characters can break the enclosing double quotes or trigger shell expansion.
  assert.doesNotMatch(script, /["`$%\r\n]/);
  const calls = [];
  const stopped = new Error("exit");
  try {
    vm.runInNewContext(script, {
      Buffer,
      process: { execPath: "node", exit: (code) => { assert.equal(code, status); throw stopped; } },
      require: (name) => ({
        path,
        os: { homedir: () => "/user home" },
        child_process: { spawnSync: (exe, args, options) => { calls.push({ exe, args: Array.from(args), options }); return { status }; } },
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

// Minimal DOM for checking the actual dialog's polling and form lifecycle.
class Element {
  children = [];
  value = "";
  textContent = "";
  append(...nodes) { for (const node of nodes) { node.remove?.(); this.children.push(node); node.parent = this; } }
  replaceChildren(...nodes) { this.children.forEach((node) => { node.parent = null; }); this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  querySelector(tag) { return this.all().find((node) => node.tag === tag); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  focus() {}
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
  const firstName = root.all().filter((node) => node.tag === "input")[1];
  firstName.value = "First project";
  firstName.oninput();
  find("+ Add project path").onclick();
  const second = root.all().filter((node) => node.tag === "input")[2];
  second.value = "/projects/second";
  second.oninput();
  const command = () => root.all().find((node) => node.className === "cmd grow" && node.textContent.startsWith('node -e "const f='));
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args[2]), [first.value, second.value]);
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args.slice(3)), [["--as", "First project"], []]);
  poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.querySelector("input"), first);
  assert.equal(first.value, "C:\\Projects\\First");
  assert.equal(firstName.value, "First project");
  root.all().filter((node) => node.textContent === "Test")[1].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.querySelector("input").value, "");
  find("Test").onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.querySelector("input"), first);
  firstName.value = "";
  firstName.oninput();
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args.slice(3)), [[], []]);
  find("Remove").onclick();
  assert.deepEqual(runCommand(command().textContent).map((call) => call.args[2]), [second.value]);
  assert.ok(requests.every(([url]) => url === "/devices"), "Paths must not be submitted to the server");
});
