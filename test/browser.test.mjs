import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../web/src/resize.ts", import.meta.url), "utf8");
const resizeCode = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

test("TV size fallback handles hidden containers, avoids duplicate callbacks, and cleans up", () => {
  let poll, resize, cleared = false, calls = 0;
  const window = {
    setInterval(fn) { poll = fn; return 42; },
    clearInterval(id) { assert.equal(id, 42); cleared = true; },
    addEventListener(name, fn) { assert.equal(name, "resize"); resize = fn; },
    removeEventListener(name, fn) { assert.equal(name, "resize"); assert.equal(fn, resize); },
  };
  const context = vm.createContext({ exports: {}, window });
  vm.runInContext(resizeCode, context);
  const pane = { clientWidth: 0, clientHeight: 0 };
  const stop = context.exports.observeSize(pane, () => calls++);
  poll();
  assert.equal(calls, 0);
  pane.clientWidth = 1920;
  pane.clientHeight = 1080;
  poll();
  assert.equal(calls, 1);
  resize();
  assert.equal(calls, 1);
  pane.clientHeight = 900;
  resize();
  assert.equal(calls, 2);
  stop();
  assert.equal(cleared, true);
});

test("modern browsers retain native size observation", () => {
  let observed, disconnected = false, received;
  class ResizeObserver {
    constructor(callback) { received = callback; }
    observe(node) { observed = node; }
    disconnect() { disconnected = true; }
  }
  const context = vm.createContext({ exports: {}, ResizeObserver });
  vm.runInContext(resizeCode, context);
  const pane = {}, callback = () => {};
  const stop = context.exports.observeSize(pane, callback);
  assert.equal(observed, pane);
  assert.equal(received, callback);
  stop();
  assert.equal(disconnected, true);
});

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const startupCode = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function startup() {
  const panel = { style: {}, textContent: "Loading" }, listeners = {};
  let timeout;
  vm.runInNewContext(startupCode, {
    document: { getElementById: () => panel },
    navigator: { userAgent: "Test Samsung TV" },
    window: { addEventListener(name, fn) { listeners[name] = fn; } },
    setTimeout(fn) { timeout = fn; return 1; },
    clearTimeout() { timeout = () => {}; },
  });
  return { panel, listeners, tick: () => timeout() };
}

test("ignored module entry leaves useful diagnostics instead of a blank screen", () => {
  const { panel, tick } = startup();
  tick();
  assert.match(panel.textContent, /Loading is taking too long/);
  assert.match(panel.textContent, /Test Samsung TV/);
});

test("successful legacy startup dismisses the loader even after a timeout", () => {
  const { panel, listeners, tick } = startup();
  tick();
  listeners["fantasy-ready"]();
  assert.equal(panel.style.display, "none");
  listeners.error({ message: "unrelated later error" });
  assert.equal(panel.style.display, "none");
});

test("async startup failures retain their diagnostic rather than a timeout", () => {
  const { panel, listeners, tick } = startup();
  listeners.unhandledrejection({ reason: new Error("Canvas unavailable") });
  tick();
  assert.match(panel.textContent, /Canvas unavailable/);
  assert.doesNotMatch(panel.textContent, /taking too long/);
});
