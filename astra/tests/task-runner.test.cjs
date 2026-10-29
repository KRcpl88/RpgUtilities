"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const html = readFileSync(path.join(__dirname, "..", "map-editor.html"), "utf8");
const source = html.match(/<script id="map-task-runner">([\s\S]*?)<\/script>/)[1];

function harness({ startupError = false, transferError = false } = {}) {
  const workers = [], urls = new Set(), timers = new Map();
  let next = 0;
  const context = vm.createContext({
    Blob,
    URL: {
      createObjectURL() { const url = `blob:test-${++next}`; urls.add(url); return url; },
      revokeObjectURL(url) { urls.delete(url); }
    },
    Worker: class {
      constructor() { if (startupError) throw new Error("Startup failed"); workers.push(this); }
      postMessage(value) { if (transferError) throw new Error("Transfer failed"); this.request = value; }
      terminate() { this.stopped = true; }
    },
    setTimeout(callback) { const id = ++next; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  return { runner: new context.MapTaskRunner.Runner("test"), workers, urls, timers };
}
const cleaned = h => {
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
  assert.ok(h.workers.every(worker => worker.stopped && worker.onmessage === null && worker.onerror === null));
};

test("worker cancellation rejects once, discards late results, cleans resources and allows retry", async () => {
  const h = harness(), first = h.runner.run({ operation: "save" }), late = h.workers[0].onmessage;
  await assert.rejects(h.runner.run({}), /already running/);
  h.runner.cancel(); h.runner.cancel();
  await assert.rejects(first, { name: "AbortError" });
  cleaned(h);
  const next = h.runner.run({ operation: "save" });
  late({ data: { ok: true, value: "stale" } });
  h.workers[1].onmessage({ data: { ok: true, value: "current" } });
  assert.equal(await next, "current");
  cleaned(h);
});

test("startup and structured-clone failures reject explicitly without leaking worker URLs", async () => {
  for (const options of [{ startupError: true }, { transferError: true }]) {
    const h = harness(options);
    await assert.rejects(h.runner.run({}), /failed/);
    cleaned(h);
  }
});

test("worker exceptions, unreadable messages, invalid responses and timeouts cleanly reject", async () => {
  for (const [fail, pattern] of [
    [h => h.workers[0].onerror({ message: "Crash", preventDefault() {} }), /Crash/],
    [h => h.workers[0].onmessageerror(), /Unable to read/],
    [h => h.workers[0].onmessage({ data: {} }), /Invalid background response/],
    [h => h.workers[0].onmessage({ data: { ok: false, error: "Bad file" } }), /Bad file/],
    [h => [...h.timers.values()][0](), /two-minute/]
  ]) {
    const h = harness(), result = h.runner.run({});
    fail(h);
    await assert.rejects(result, pattern);
    cleaned(h);
  }
});
