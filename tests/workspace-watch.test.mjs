import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { createRenderer, nextTick, ref } from "vue";
import { setImmediate } from "node:timers/promises";
import {
  createLocalWorkspaceProfile,
  registerWorkspaceProfile,
  subscribeWorkspace,
  watchWorkspace,
  workspaceWatchable,
} from "../src/modules/workspace-api/index.ts";
import { useDirectoryWatch } from "../src/modules/workspace/modules/tree/lib/directory-watch.ts";
import { useFileSync } from "../src/modules/workspace/lib/file-sync.ts";
import { registerBuiltinClientAgents } from "../src/app/agents.ts";

registerBuiltinClientAgents();

function setup(profile) {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  onTestFinished(() => vi.unstubAllGlobals());
  const unregister = registerWorkspaceProfile("watch-test", profile);
  onTestFinished(unregister);
  return window;
}

function mount(callback) {
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
  const app = renderer.createApp({
    setup() {
      callback();
      return () => null;
    },
  });
  app.mount({});
  onTestFinished(() => app.unmount());
  return app;
}

test("watch is a provider capability, including a decorated local profile, with project-filtered events", async () => {
  const profile = createLocalWorkspaceProfile("watch-test");
  profile.id = "local-github";
  const window = setup(profile);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  expect(workspaceWatchable("watch-test")).toBe(true);
  await watchWorkspace("watch-test", { paths: ["a.ts"] }, true);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/projects/watch-test/workspace/watch");
  expect(JSON.parse(options.body)).toMatchObject({ paths: ["a.ts"], client: expect.any(String) });
  expect(options.keepalive).toBe(true);
  const file = vi.fn();
  const unsubscribe = subscribeWorkspace("watch-test", { file });
  const emit = (projectId) =>
    window.dispatchEvent(
      new CustomEvent("projector:file-changed", { detail: { projectId, path: "a.ts" } }),
    );
  emit("other");
  emit("watch-test");
  expect(file.mock.calls).toStrictEqual([["a.ts"]]);
  unsubscribe();
  emit("watch-test");
  expect(file).toHaveBeenCalledTimes(1);
});

test("a new provider supplies watch without HTTP or local event conventions", async () => {
  let handlers;
  const update = vi.fn(async () => true);
  const release = vi.fn();
  const profile = createLocalWorkspaceProfile("unused");
  profile.id = "memory";
  profile.providers.files.watch = {
    update,
    subscribe: (next) => {
      handlers = next;
      return release;
    },
  };
  setup(profile);
  const reload = vi.fn();
  const app = mount(() => useDirectoryWatch({ projectId: "watch-test", path: "src" }, reload));
  expect(workspaceWatchable("watch-test")).toBe(true);
  await watchWorkspace("watch-test", { paths: ["a"] });
  expect(update).toHaveBeenCalledWith({ paths: ["a"] }, false);
  handlers.directory("other");
  handlers.directory("src");
  expect(reload).toHaveBeenCalledTimes(1);
  app.unmount();
  expect(release).toHaveBeenCalledTimes(1);
});

test("directory refresh on focus also works without a live watch provider", async () => {
  const profile = createLocalWorkspaceProfile("unused");
  delete profile.providers.files.watch;
  const window = setup(profile);
  const reload = vi.fn();
  const fetch = vi.spyOn(globalThis, "fetch");
  const app = mount(() => useDirectoryWatch({ projectId: "watch-test", path: "" }, reload));
  expect(workspaceWatchable("watch-test")).toBe(false);
  expect(await watchWorkspace("watch-test", { directories: [""] })).toBe(false);
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("focus"));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  app.unmount();
  window.dispatchEvent(new Event("focus"));
  expect(reload).toHaveBeenCalledTimes(1);
});

test("open files subscribe to the selected provider and release the previous project", async () => {
  const profile = createLocalWorkspaceProfile("unused");
  let handlers;
  const release = vi.fn();
  const update = vi.fn(async () => true);
  profile.providers.files = {
    assetUrl: () => "",
    read: async () => ({ content: "new version" }),
    watch: {
      update,
      subscribe: (next) => {
        handlers = next;
        return release;
      },
    },
  };
  setup(profile);
  const tabs = ref([{ path: "a.ts", content: "old version" }]);
  const projectId = ref("watch-test");
  const changed = vi.fn();
  const app = mount(() =>
    useFileSync({ projectId: () => projectId.value, tabs, isDirty: () => false, changed }),
  );
  handlers.file("a.ts");
  await setImmediate();
  expect(tabs.value[0].content).toBe("new version");
  expect(changed).toHaveBeenCalledOnce();
  const next = { ...profile, providers: { files: { assetUrl: () => "", read: async () => ({}) } } };
  const unregister = registerWorkspaceProfile("next-project", next);
  onTestFinished(unregister);
  projectId.value = "next-project";
  await nextTick();
  expect(release).toHaveBeenCalledOnce();
  expect(update).toHaveBeenLastCalledWith({ paths: [] }, false);
  app.unmount();
  expect(release).toHaveBeenCalledOnce();
});
