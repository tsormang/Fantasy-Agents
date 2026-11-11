import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(file) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
}

const modeCode = compile("../web/src/mode.ts");
test("lite routes keep spectator tokens, options and fragments when switching", () => {
  for (const pathname of ["/watch/abc-123", "/lite/watch/abc-123"]) {
    const context = vm.createContext({ exports: {}, location: { pathname, search: "?night=0", hash: "#heroes" } });
    vm.runInContext(modeCode, context);
    const mode = context.exports;
    assert.equal(mode.path, "/watch/abc-123");
    assert.equal(mode.alternateModePath(), (mode.lite ? "/watch/abc-123" : "/lite/watch/abc-123") + "?night=0#heroes");
    assert.equal(mode.modePath("/"), mode.lite ? "/lite" : "/");
    assert.equal(mode.modePath("/admin"), mode.lite ? "/lite/admin" : "/admin");
  }
});

test("only the lite path segment selects lightweight graphics", () => {
  for (const [pathname, expected] of [["/lite", true], ["/lite/", true], ["/", false], ["/literature", false]]) {
    const context = vm.createContext({ exports: {}, location: { pathname } });
    vm.runInContext(modeCode, context);
    assert.equal(context.exports.lite, expected);
  }
});

test("lite canvas stays small on a high-DPI TV, caps frames, pauses hidden tabs and supports mouse picking", () => {
  let nextFrame, resize, sync;
  let draws = 0, updates = 0;
  const handlers = {};
  const g = new Proxy({}, { get: () => () => {}, set: () => true });
  const document = {
    hidden: false,
    createElement: () => ({ style: {}, getContext: () => g, addEventListener: (name, fn) => { handlers[name] = fn; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
  };
  class Sim {
    selected = null;
    constructor(layout) { this.L = layout; }
    sync(agents) { this.agents = agents; }
    setLayout(layout) { this.L = layout; }
    update() { updates++; }
    draw() { draws++; }
    pick(x, y) { assert.equal(x, 100); assert.equal(y, 50); return "hero"; }
  }
  const deps = {
    "../resize": { observeSize: (_root, cb) => { resize = cb; } },
    "./pix": { canvas: (w, h) => [{ width: w, height: h }, g] },
    "./sim": { Sim },
    "./world": { makeLayout: (W, H) => ({ W, H, glows: [], flames: [], chimneys: [], portal: { x: 30, y: 30 } }), paintWorld: () => ({}) },
  };
  const context = vm.createContext({
    exports: {}, document, URLSearchParams, location: { search: "?night=0" },
    window: { devicePixelRatio: 3, setTimeout: (fn) => fn() },
    setInterval() {}, clearTimeout() {}, requestAnimationFrame: (fn) => { nextFrame = fn; },
    require: (name) => { assert.ok(deps[name], `Unexpected dependency: ${name}`); return deps[name]; },
  });
  vm.runInContext(compile("../web/src/game-lite/game.ts"), context);
  const root = { clientWidth: 1920, clientHeight: 1080, appendChild() {} };
  const agents = new Map();
  const game = new context.exports.Game(root, { ready: true, agents, now: () => 1000, onChange: (fn) => { sync = fn; } });
  assert.equal(game.el.width, 480);
  assert.equal(game.el.height, 270);
  assert.equal(game.sim.agents, agents);
  nextFrame(40);
  nextFrame(50);
  assert.equal(draws, 1);
  nextFrame(80);
  assert.equal(draws, 2);
  document.hidden = true;
  nextFrame(120);
  assert.equal(updates, 2);
  document.hidden = false;
  nextFrame(160);
  assert.equal(draws, 3);
  handlers.mousedown({ clientX: 400, clientY: 200 });
  assert.equal(game.sim.selected, "hero");
  root.clientWidth = 1280;
  resize();
  assert.equal(game.el.width, 320);
  sync();
});
