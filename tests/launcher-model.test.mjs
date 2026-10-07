import { expect, test, vi } from "vite-plus/test";
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

test("editing the query immediately blocks stale launches and discards an old search reply", async () => {
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
    expect(await model.launch(item("old"))).toBe(false);
    await model.search();
    old.resolve({ items: [item("old")] });
    await pending;
    expect(model.state.items[0].id).toBe("new");
    expect(launches).toStrictEqual([]);
    expect(model.state.loading).toBe(false);
  } finally {
    model.dispose();
  }
});

test("both renderers share selection, duplicate launch prevention, errors and disposal", async () => {
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
  expect(model.state.selected).toBe(1);
  const launching = model.launch();
  expect(await model.launch()).toBe(false);
  pending.resolve();
  expect(await launching).toBe(false);
  expect(calls).toBe(1);
  expect(model.state.error).toBe("Launch failed");
  expect(model.state.busy).toBe(false);
  model.dispose();
  const before = renders;
  expect(await model.launch()).toBe(false);
  expect(renders).toBe(before);
});

test("a failed new query clears previous results so they cannot be launched", async () => {
  const model = createLauncherModel({
    search: async (query) => {
      if (query) throw new Error("Search failed");
      return { items: [item("old")] };
    },
    launch: async () => {
      expect.unreachable("An obsolete result must not launch");
    },
  });
  try {
    await model.search();
    model.setQuery("new");
    await model.search();
    expect(model.state.items).toStrictEqual([]);
    expect(model.state.error).toBe("Search failed");
    expect(await model.launch()).toBe(false);
  } finally {
    model.dispose();
  }
});

test("native and browser clients send the same launch contract and preserve server errors", async () => {
  const requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ error: "Приложение больше не доступно" }), {
      status: 400,
    });
  });
  for (const base of ["", "http://localhost:4177"]) {
    await expect(createLauncherClient(base).launch("app:probe.desktop")).rejects.toThrow(
      /Приложение больше не доступно/,
    );
  }
  expect(requests[0].url).toBe("/api/launcher/launch");
  expect(requests[1].url).toBe("http://localhost:4177/api/launcher/launch");
  expect(requests[0].options.body).toBe(requests[1].options.body);
});

test("entering an item loads its detail, leaving or a new query closes it, launch passes the action argument", async () => {
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
    expect(await model.enter()).toBe(true);
    expect(model.state.focus.id).toBe("p");
    expect(model.state.detail.actions.length).toBe(2);
    expect(model.state.detail.failure.output).toBe("boom");
    expect(await model.launch(model.state.focus, model.state.detail.actions[1], true)).toBe(true);
    expect(launches[0]).toStrictEqual(["p", "run", true, "dev"]);
    model.leave();
    expect(model.state.focus).toBe(null);
    await model.enter();
    model.setQuery("x");
    expect(model.state.focus).toBe(null);
    expect(model.state.detail).toBe(null);
  } finally {
    model.dispose();
  }
});

test("query prefixes choose the search scope", async () => {
  const { parseLaunchQuery } = await import("../core/modules/launcher/index.ts");
  expect(parseLaunchQuery("chrome")).toStrictEqual({ scope: "all", text: "chrome" });
  expect(parseLaunchQuery("/proj")).toStrictEqual({ scope: "projects", text: "proj" });
  expect(parseLaunchQuery("/")).toStrictEqual({ scope: "projects", text: "" });
  expect(parseLaunchQuery("gh/own/repo")).toStrictEqual({ scope: "github", text: "own/repo" });
  expect(parseLaunchQuery("GH/")).toStrictEqual({ scope: "github", text: "" });
  expect(parseLaunchQuery("ghost")).toStrictEqual({ scope: "all", text: "ghost" });
  // A github.com link is the same as gh/owner/repo.
  const github = (text) => ({ scope: "github", text });
  expect(parseLaunchQuery("https://github.com/Sdju/bapm")).toStrictEqual(github("Sdju/bapm"));
  expect(parseLaunchQuery("  http://www.GitHub.com/Sdju/bapm.git")).toStrictEqual(
    github("Sdju/bapm"),
  );
  expect(parseLaunchQuery("https://github.com/Sdju/bapm/tree/main?tab=x#top")).toStrictEqual(
    github("Sdju/bapm"),
  );
  expect(parseLaunchQuery("https://github.com/Sdju/")).toStrictEqual(github("Sdju/"));
  expect(parseLaunchQuery("https://github.com/Sdju")).toStrictEqual(github("Sdju/"));
  // Any host with "gitlab" in its name is gl/<path>; nested groups and /-/ pages are kept or cut.
  const gitlab = (text) => ({ scope: "gitlab", text });
  expect(parseLaunchQuery("gl/zede/fore")).toStrictEqual(gitlab("zede/fore"));
  expect(parseLaunchQuery("https://gitlab.com/zede/forester.git")).toStrictEqual(
    gitlab("zede/forester"),
  );
  expect(parseLaunchQuery("https://gitlab.example.com:8443/a/b/c/-/tree/main?x#y")).toStrictEqual(
    gitlab("a/b/c"),
  );
  expect(parseLaunchQuery("https://git.gitlab-x.org/zede")).toStrictEqual(gitlab("zede/"));
  expect(parseLaunchQuery("https://gitlab.com")).toStrictEqual(gitlab(""));
  expect(parseLaunchQuery("https://example.com/gitlab/x")).toStrictEqual({
    scope: "all",
    text: "https://example.com/gitlab/x",
  });
  expect(parseLaunchQuery("https://github.com/")).toStrictEqual(github(""));
  expect(parseLaunchQuery("https://github.com")).toStrictEqual(github(""));
  expect(parseLaunchQuery("https://github.community/x")).toStrictEqual({
    scope: "all",
    text: "https://github.community/x",
  });
  expect(parseLaunchQuery("https://example.com/Sdju/bapm")).toStrictEqual({
    scope: "all",
    text: "https://example.com/Sdju/bapm",
  });
});

test("process events refresh the list and the open card without moving the selection", async () => {
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
    expect(model.state.detail.info.stateLabel).toBe("v0");
    model.live(true);
    version = 1;
    notify();
    notify();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(model.state.items[model.state.selected].id).toBe("b");
    expect(model.state.focus.id).toBe("b");
    expect(model.state.detail.info.stateLabel).toBe("v1");
    model.live(false);
    expect(unsubscribed).toBe(true);
  } finally {
    model.dispose();
  }
});
