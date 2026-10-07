import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createRenderer, ref } from "vue";
import { createCommandService } from "../core/modules/ide/index.ts";
import { commandHostKey } from "../src/common/utilities/commands.ts";
import { useNetworkSettings } from "../src/modules/network/model.ts";
import { waitForNetworkRestart } from "../src/modules/network/client.ts";

function mount(t, view = "settings", sdk = createCommandService()) {
  const renderer = createRenderer({
    createComment: () => ({}),
    createText: () => ({}),
    createElement: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  });
  let model;
  const app = renderer.createApp({
    setup() {
      model = useNetworkSettings(view);
      return () => null;
    },
  });
  app.provide(commandHostKey, { revision: ref(0), createScope: sdk.createScope, reportError() {} });
  app.mount({});
  t.after(() => app.unmount());
  return { app, model, sdk, run: (id, args) => model.commands.scope.executeCommand(id, args) };
}

const initial = () => ({
  mode: "lan",
  passwordRequired: true,
  lanUrl: "http://192.0.2.1:4177",
  lanUrls: ["http://192.0.2.1:4177"],
});

test("network scopes share operations, preserve drafts, validate arguments and report HTTP failures", async (t) => {
  const saved = initial();
  const posts = [];
  let rejectPost = false;
  let release;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url === "/api/health") return Response.json({ pid: 10 });
    if (options.method !== "POST") return Response.json(saved);
    const body = JSON.parse(options.body);
    posts.push(body);
    if (rejectPost) return Response.json({ error: "Local access only" }, { status: 403 });
    if (release) await release.promise;
    if (body.password !== undefined) saved.passwordRequired = !!body.password;
    return Response.json({ ok: true, restarted: false });
  });
  const sdk = createCommandService();
  const settings = mount(t, "settings", sdk);
  const panel = mount(t, "panel", sdk);
  await setImmediate();
  assert.equal(sdk.getScopes().length, 2);
  assert.equal(settings.model.ready.value, true);
  settings.model.mode.value = "local";
  settings.model.password.value = "settings draft";
  assert.equal(panel.model.mode.value, "lan");
  assert.equal(panel.model.password.value, "");
  await settings.run("ide.network.refresh");
  assert.equal(settings.model.mode.value, "lan");
  assert.equal(settings.model.password.value, "settings draft");
  await panel.run("ide.network.save");
  assert.deepEqual(posts.at(-1), { mode: "lan" });
  await panel.run("ide.network.save", { password: "  replacement  " });
  assert.deepEqual(posts.at(-1), { mode: "lan", password: "  replacement  " });
  assert.equal(panel.model.status.value, "Сохранено");
  await panel.run("ide.network.password.clear");
  assert.deepEqual(posts.at(-1), { mode: "lan", password: "" });
  assert.equal(panel.model.passwordRequired.value, false);
  await assert.rejects(panel.run("ide.network.password.clear"), /недоступна/);
  const before = posts.length;
  await assert.rejects(panel.run("ide.network.save", { mode: "invalid" }), /Режим/);
  await assert.rejects(panel.run("ide.network.save", { password: 1 }), /строкой/);
  assert.equal(posts.length, before);
  panel.model.password.value = "retry draft";
  rejectPost = true;
  await assert.rejects(panel.run("ide.network.save"), /Local access only/);
  assert.equal(panel.model.error.value, "Local access only");
  assert.equal(panel.model.password.value, "retry draft");
  assert.equal(panel.model.busy.value, false);
  rejectPost = false;
  let resolve;
  release = {
    promise: new Promise((done) => {
      resolve = done;
    }),
  };
  const pending = panel.run("ide.network.save");
  await setImmediate();
  assert.equal(panel.model.busy.value, true);
  await assert.rejects(panel.run("ide.network.save"), /недоступна/);
  resolve();
  await pending;
  assert.equal(panel.model.error.value, "");
  assert.equal(panel.model.password.value, "");
  for (const scope of sdk.getScopes()) assert.equal("password" in scope.context, false);
});

test("failed initial load can retry and unmount aborts without applying late results", async (t) => {
  let fail = true;
  let finish;
  let signal;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    if (fail) return Response.json({ error: "Cannot load" }, { status: 500 });
    if (finish === undefined) return Response.json(initial());
    signal = options.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { app, model, run, sdk } = mount(t);
  await setImmediate();
  assert.equal(model.ready.value, false);
  assert.equal(model.error.value, "Cannot load");
  await assert.rejects(run("ide.network.save"), /недоступна/);
  fail = false;
  await run("ide.network.refresh");
  assert.equal(model.ready.value, true);
  finish = null;
  const pending = run("ide.network.refresh");
  await setImmediate();
  app.unmount();
  assert.equal(signal.aborted, true);
  assert.equal(sdk.getScopes().length, 0);
  finish(Response.json({ ...initial(), mode: "local" }));
  await pending;
  assert.equal(model.state.value.mode, "lan");
});

test("mode changes wait for a new PID before reload; unavailable health blocks the change", async (t) => {
  let healthCalls = 0;
  let healthMissing = true;
  let writes = 0;
  let reloads = 0;
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      reload() {
        reloads++;
      },
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url === "/api/health") {
      healthCalls++;
      return healthMissing
        ? Response.json({}, { status: 503 })
        : Response.json({ pid: healthCalls === 2 ? 10 : 11 });
    }
    if (options.method === "POST") {
      writes++;
      return Response.json({ ok: true, restarted: true });
    }
    return Response.json(initial());
  });
  const { model, run } = mount(t);
  await setImmediate();
  await assert.rejects(run("ide.network.save", { mode: "local" }), /PID/);
  assert.equal(writes, 0);
  assert.equal(reloads, 0);
  healthMissing = false;
  await run("ide.network.save", { mode: "local" });
  assert.equal(writes, 1);
  assert.equal(reloads, 1);
  assert.equal(healthCalls, 3);
  assert.equal(model.password.value, "");
});

test("restart polling tolerates downtime, requires a different PID and has a deadline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const pids = [10, null, 10, 11];
  t.mock.method(globalThis, "fetch", async () => {
    const pid = pids.shift();
    return pid === null ? Response.json({}, { status: 503 }) : Response.json({ pid });
  });
  const pending = waitForNetworkRestart(10, new AbortController().signal);
  await setImmediate();
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(500);
    await setImmediate();
  }
  await pending;
  t.mock.method(globalThis, "fetch", async () => Response.json({ pid: 10 }));
  const timedOut = assert.rejects(
    waitForNetworkRestart(10, new AbortController().signal),
    /60 секунд/,
  );
  await setImmediate();
  t.mock.timers.tick(60000);
  await timedOut;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForNetworkRestart(10, controller.signal), /abort/i);
});
