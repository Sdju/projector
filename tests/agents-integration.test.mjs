import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createRenderer } from "vue";
import { createUsageCache } from "../server/modules/agents-integration/_/usage-cache.ts";
import { useUsagePolling } from "../src/modules/agents-integration/_/use-usage-polling.ts";

test("usage cache survives loader replacement during a pending HMR request", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  const state = {};
  let finish;
  const first = createUsageCache(state, () => new Promise((resolve) => { finish = resolve; }));
  const pending = first();
  let calls = 0;
  const replacement = createUsageCache(state, async () => {
    calls++;
    return { checkedAt: Date.now() };
  });
  assert.equal(replacement(), pending);
  await Promise.resolve();
  const response = { checkedAt: Date.now() };
  finish(response);
  assert.equal(await pending, response);
  assert.equal(await replacement(), response);
  assert.equal(calls, 0);
  t.mock.timers.tick(60000);
  await replacement();
  assert.equal(calls, 1);
});

test("failed cache loads release pending state so a later request can recover", async () => {
  const state = {};
  const broken = createUsageCache(state, async () => { throw new Error("offline"); });
  await assert.rejects(broken(), /offline/);
  assert.equal(state.pending, undefined);
  const recovered = createUsageCache(state, async () => ({ checkedAt: Date.now() }));
  assert.ok((await recovered()).checkedAt);
});

function mountPolling(t, options) {
  const document = new EventTarget();
  document.hidden = false;
  const original = globalThis.document;
  globalThis.document = document;
  const renderer = createRenderer({
    createComment: () => ({}), createText: () => ({}), createElement: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  });
  let model;
  const app = renderer.createApp({
    setup() {
      model = useUsagePolling("/api/fixture/usage", options);
      return () => null;
    },
  });
  app.mount({});
  t.after(() => {
    app.unmount();
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  return { model, document, app };
}

test("polling respects server retry time, hidden pages and unmount cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ nextCheckAt: Date.now() + 3600000 });
  });
  const { model, document, app } = mountPolling(t, {
    intervalMs: 300000, nextCheckAt: (value) => value.nextCheckAt,
  });
  await setImmediate();
  assert.equal(calls, 1);
  assert.equal(model.failed.value, false);
  t.mock.timers.tick(3599999);
  await setImmediate();
  assert.equal(calls, 1);
  document.hidden = true;
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(calls, 1);
  document.hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.equal(calls, 2);
  app.unmount();
  document.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(3600000);
  await setImmediate();
  assert.equal(calls, 2);
});

test("polling deduplicates in-flight refreshes and aborts on unmount", async (t) => {
  let calls = 0;
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  const { model, document, app } = mountPolling(t);
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 1);
  app.unmount();
  await setImmediate();
  assert.equal(signal.aborted, true);
  assert.equal(model.failed.value, false);
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 1);
});

test("HTTP polling errors retain last usage and recover on the next interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 2 ? new Response(null, { status: 503 }) : Response.json({ sequence: calls });
  });
  const { model } = mountPolling(t);
  await setImmediate();
  assert.equal(model.usage.value.sequence, 1);
  t.mock.timers.tick(60000);
  await setImmediate();
  assert.equal(model.failed.value, true);
  assert.equal(model.usage.value.sequence, 1);
  t.mock.timers.tick(60000);
  await setImmediate();
  assert.equal(model.failed.value, false);
  assert.equal(model.usage.value.sequence, 3);
});
