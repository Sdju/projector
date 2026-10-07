import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { setImmediate } from "node:timers/promises";
import { createRenderer, ref } from "vue";
import { createCommandService } from "../core/modules/ide/index.ts";
import { commandHostKey } from "../src/common/utilities/commands.ts";
import { useNetworkSettings } from "../src/modules/network/model.ts";
import { waitForNetworkRestart } from "../src/modules/network/client.ts";

function mount(view = "settings", sdk = createCommandService()) {
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
  onTestFinished(() => app.unmount());
  return { app, model, sdk, run: (id, args) => model.commands.scope.executeCommand(id, args) };
}

const initial = () => ({
  mode: "lan",
  passwordRequired: true,
  lanUrl: "http://192.0.2.1:4177",
  lanUrls: ["http://192.0.2.1:4177"],
});

test("network scopes share operations, preserve drafts, validate arguments and report HTTP failures", async () => {
  const saved = initial();
  const posts = [];
  let rejectPost = false;
  let release;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
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
  const settings = mount("settings", sdk);
  const panel = mount("panel", sdk);
  await setImmediate();
  expect(sdk.getScopes().length).toBe(2);
  expect(settings.model.ready.value).toBe(true);
  settings.model.mode.value = "local";
  settings.model.password.value = "settings draft";
  expect(panel.model.mode.value).toBe("lan");
  expect(panel.model.password.value).toBe("");
  await settings.run("ide.network.refresh");
  expect(settings.model.mode.value).toBe("lan");
  expect(settings.model.password.value).toBe("settings draft");
  await panel.run("ide.network.save");
  expect(posts.at(-1)).toStrictEqual({ mode: "lan" });
  await panel.run("ide.network.save", { password: "  replacement  " });
  expect(posts.at(-1)).toStrictEqual({ mode: "lan", password: "  replacement  " });
  expect(panel.model.status.value).toBe("Сохранено");
  await panel.run("ide.network.password.clear");
  expect(posts.at(-1)).toStrictEqual({ mode: "lan", password: "" });
  expect(panel.model.passwordRequired.value).toBe(false);
  await expect(panel.run("ide.network.password.clear")).rejects.toThrow(/недоступна/);
  const before = posts.length;
  await expect(panel.run("ide.network.save", { mode: "invalid" })).rejects.toThrow(/Режим/);
  await expect(panel.run("ide.network.save", { password: 1 })).rejects.toThrow(/строкой/);
  expect(posts.length).toBe(before);
  panel.model.password.value = "retry draft";
  rejectPost = true;
  await expect(panel.run("ide.network.save")).rejects.toThrow(/Local access only/);
  expect(panel.model.error.value).toBe("Local access only");
  expect(panel.model.password.value).toBe("retry draft");
  expect(panel.model.busy.value).toBe(false);
  rejectPost = false;
  let resolve;
  release = {
    promise: new Promise((done) => {
      resolve = done;
    }),
  };
  const pending = panel.run("ide.network.save");
  await setImmediate();
  expect(panel.model.busy.value).toBe(true);
  await expect(panel.run("ide.network.save")).rejects.toThrow(/недоступна/);
  resolve();
  await pending;
  expect(panel.model.error.value).toBe("");
  expect(panel.model.password.value).toBe("");
  for (const scope of sdk.getScopes()) expect("password" in scope.context).toBe(false);
});

test("failed initial load can retry and unmount aborts without applying late results", async () => {
  let fail = true;
  let finish;
  let signal;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_, options) => {
    if (fail) return Response.json({ error: "Cannot load" }, { status: 500 });
    if (finish === undefined) return Response.json(initial());
    signal = options.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { app, model, run, sdk } = mount();
  await setImmediate();
  expect(model.ready.value).toBe(false);
  expect(model.error.value).toBe("Cannot load");
  await expect(run("ide.network.save")).rejects.toThrow(/недоступна/);
  fail = false;
  await run("ide.network.refresh");
  expect(model.ready.value).toBe(true);
  finish = null;
  const pending = run("ide.network.refresh");
  await setImmediate();
  app.unmount();
  expect(signal.aborted).toBe(true);
  expect(sdk.getScopes().length).toBe(0);
  finish(Response.json({ ...initial(), mode: "local" }));
  await pending;
  expect(model.state.value.mode).toBe("lan");
});

test("mode changes wait for a new PID before reload; unavailable health blocks the change", async () => {
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
  onTestFinished(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
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
  const { model, run } = mount();
  await setImmediate();
  await expect(run("ide.network.save", { mode: "local" })).rejects.toThrow(/PID/);
  expect(writes).toBe(0);
  expect(reloads).toBe(0);
  healthMissing = false;
  await run("ide.network.save", { mode: "local" });
  expect(writes).toBe(1);
  expect(reloads).toBe(1);
  expect(healthCalls).toBe(3);
  expect(model.password.value).toBe("");
});

test("restart polling tolerates downtime, requires a different PID and has a deadline", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: 100000 });
  const pids = [10, null, 10, 11];
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const pid = pids.shift();
    return pid === null ? Response.json({}, { status: 503 }) : Response.json({ pid });
  });
  const pending = waitForNetworkRestart(10, new AbortController().signal);
  await setImmediate();
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(500);
    await setImmediate();
  }
  await pending;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ pid: 10 }));
  const timedOut = expect(waitForNetworkRestart(10, new AbortController().signal)).rejects.toThrow(
    /60 секунд/,
  );
  await setImmediate();
  vi.advanceTimersByTime(60000);
  await timedOut;
  const controller = new AbortController();
  controller.abort();
  await expect(waitForNetworkRestart(10, controller.signal)).rejects.toThrow(/abort/i);
});
