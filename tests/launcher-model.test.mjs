import assert from "node:assert/strict";
import { test } from "node:test";
import { createLauncherModel } from "../core/modules/launcher/index.ts";
import { createLauncherClient } from "../core/modules/launcher/index.ts";

const item = (id) => ({ id, name: id, description: "", keywords: "", kind: "application" });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

await test("editing the query immediately blocks stale launches and discards an old search reply", async () => {
  const old = deferred();
  const launches = [];
  const model = createLauncherModel({
    search: (query) => (query === "new" ? Promise.resolve({ items: [item("new")] }) : old.promise),
    launch: async (id) => {
      launches.push(id);
    },
  });
  try {
    const pending = model.search();
    model.setQuery("new");
    assert.equal(await model.launch(item("old")), false);
    await model.search();
    old.resolve({ items: [item("old")] });
    await pending;
    assert.equal(model.state.items[0].id, "new");
    assert.deepEqual(launches, []);
    assert.equal(model.state.loading, false);
  } finally {
    model.dispose();
  }
});

await test("both renderers share selection, duplicate launch prevention, errors and disposal", async () => {
  const pending = deferred();
  let calls = 0;
  const model = createLauncherModel({
    search: async () => ({ items: [item("one"), item("two")] }),
    launch: async () => {
      calls++;
      await pending.promise;
      throw new Error("Launch failed");
    },
  });
  let renders = 0;
  model.subscribe(() => {
    renders++;
  });
  await model.search();
  model.move(10);
  assert.equal(model.state.selected, 1);
  const launching = model.launch();
  assert.equal(await model.launch(), false);
  pending.resolve();
  assert.equal(await launching, false);
  assert.equal(calls, 1);
  assert.equal(model.state.error, "Launch failed");
  assert.equal(model.state.busy, false);
  model.dispose();
  const before = renders;
  assert.equal(await model.launch(), false);
  assert.equal(renders, before);
});

await test("a failed new query clears previous results so they cannot be launched", async () => {
  const model = createLauncherModel({
    search: async (query) => {
      if (query) throw new Error("Search failed");
      return { items: [item("old")] };
    },
    launch: async () => {
      assert.fail("An obsolete result must not launch");
    },
  });
  try {
    await model.search();
    model.setQuery("new");
    await model.search();
    assert.deepEqual(model.state.items, []);
    assert.equal(model.state.error, "Search failed");
    assert.equal(await model.launch(), false);
  } finally {
    model.dispose();
  }
});

await test("native and browser clients send the same launch contract and preserve server errors", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ error: "Приложение больше не доступно" }), {
      status: 400,
    });
  });
  for (const base of ["", "http://localhost:4177"]) {
    await assert.rejects(
      createLauncherClient(base).launch("app:probe.desktop"),
      /Приложение больше не доступно/,
    );
  }
  assert.equal(requests[0].url, "/api/launcher/launch");
  assert.equal(requests[1].url, "http://localhost:4177/api/launcher/launch");
  assert.equal(requests[0].options.body, requests[1].options.body);
});

await test("entering an item loads its detail, leaving or a new query closes it, launch passes the action argument", async () => {
  const launches = [];
  const model = createLauncherModel({
    search: async () => ({
      items: [{ ...item("p"), kind: "project", actions: [{ id: "open", title: "o" }] }],
    }),
    detail: async () => ({
      actions: [
        { id: "open", title: "Открыть" },
        { id: "run", title: "Запустить dev", arg: "dev" },
      ],
      failure: { command: "dev", exitCode: 1, output: "boom" },
    }),
    launch: async (...args) => {
      launches.push(args);
      return { ok: true };
    },
  });
  try {
    await model.search();
    assert.equal(await model.enter(), true);
    assert.equal(model.state.focus.id, "p");
    assert.equal(model.state.detail.actions.length, 2);
    assert.equal(model.state.detail.failure.output, "boom");
    assert.equal(await model.launch(model.state.focus, model.state.detail.actions[1], true), true);
    assert.deepEqual(launches[0], ["p", "run", true, "dev"]);
    model.leave();
    assert.equal(model.state.focus, null);
    await model.enter();
    model.setQuery("x");
    assert.equal(model.state.focus, null);
    assert.equal(model.state.detail, null);
  } finally {
    model.dispose();
  }
});

await test("query prefixes choose the search scope", async () => {
  const { parseLaunchQuery } = await import("../core/modules/launcher/index.ts");
  assert.deepEqual(parseLaunchQuery("chrome"), { scope: "all", text: "chrome" });
  assert.deepEqual(parseLaunchQuery("/proj"), { scope: "projects", text: "proj" });
  assert.deepEqual(parseLaunchQuery("/"), { scope: "projects", text: "" });
  assert.deepEqual(parseLaunchQuery("gh/own/repo"), { scope: "github", text: "own/repo" });
  assert.deepEqual(parseLaunchQuery("GH/"), { scope: "github", text: "" });
  assert.deepEqual(parseLaunchQuery("ghost"), { scope: "all", text: "ghost" });
});

await test("process events refresh the list and the open card without moving the selection", async () => {
  let notify = () => {};
  let unsubscribed = false;
  let version = 0;
  const model = createLauncherModel({
    search: async () => ({ items: [item("a"), item("b")] }),
    detail: async () => ({
      actions: [],
      info: { path: "~/x", state: "idle", stateLabel: `v${version}` },
    }),
    launch: async () => ({ ok: true }),
    subscribe: (onStatus) => {
      notify = onStatus;
      return () => {
        unsubscribed = true;
      };
    },
  });
  try {
    await model.search();
    model.select(1);
    await model.enter();
    assert.equal(model.state.detail.info.stateLabel, "v0");
    model.live(true);
    version = 1;
    notify();
    notify();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(model.state.items[model.state.selected].id, "b");
    assert.equal(model.state.focus.id, "b");
    assert.equal(model.state.detail.info.stateLabel, "v1");
    model.live(false);
    assert.equal(unsubscribed, true);
  } finally {
    model.dispose();
  }
});
