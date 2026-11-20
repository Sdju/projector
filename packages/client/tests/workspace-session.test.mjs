import { expect, test } from "vite-plus/test";
import { effectScope, nextTick, ref, watch } from "vue";
import { setTimeout as delay } from "node:timers/promises";
import { useSessionSnapshot } from "../common/utilities/session-snapshot.ts";
import { treeSessionSchema } from "../modules/workspace/modules/tree/lib/tree-session.ts";
import { workspaceSessionSchema } from "../modules/workspace/session.ts";

function fixture() {
  const values = new Map();
  const writes = [];
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
  const scope = effectScope();
  const key = ref("project-a");
  const state = ref(new Set());
  const enabled = ref(true);
  const session = scope.run(() =>
    useSessionSnapshot(
      () => key.value,
      () => [...state.value],
      treeSessionSchema,
      () => enabled.value,
    ),
  );
  return { scope, key, state, enabled, session, values, writes };
}

test("rapid tree changes are batched; unchanged snapshots do not write", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 20; i++) f.state.value.add(`folder-${i}`);
    expect(f.writes.length).toBe(0);
    await delay(700);
    expect(f.writes.length).toBe(1);
    expect(JSON.parse(f.values.get("project-a")).length).toBe(20);
    f.state.value = new Set(f.state.value);
    f.session.flush();
    expect(f.writes.length).toBe(1);
  } finally {
    f.scope.stop();
  }
});

test("page exit flushes before debounce; switching projects flushes to the old key", async () => {
  const f = fixture();
  try {
    await nextTick();
    f.state.value.add("src/nested");
    window.dispatchEvent(new Event("beforeunload"));
    expect(JSON.parse(f.values.get("project-a"))).toStrictEqual(["src/nested"]);
    f.state.value.add("docs");
    f.key.value = "project-b";
    expect(JSON.parse(f.values.get("project-a"))).toStrictEqual(["src/nested", "docs"]);
    f.state.value = new Set(["other"]);
    f.scope.stop();
    expect(JSON.parse(f.values.get("project-b"))).toStrictEqual(["other"]);
    await delay(700);
    expect(f.writes.length).toBe(3);
  } finally {
    f.scope.stop();
  }
});

test("restoration is not saved halfway; invalid and unavailable storage is ignored", () => {
  const f = fixture();
  try {
    f.values.set("project-a", "{broken");
    expect(f.session.read()).toBe(undefined);
    f.values.set("project-a", "[123]");
    expect(f.session.read()).toBe(undefined);
    f.values.set("project-a", '["src"]');
    expect(f.session.read()).toStrictEqual(["src"]);
    f.enabled.value = false;
    f.state.value.add("restoring");
    f.session.flush();
    expect(f.writes.length).toBe(0);
    f.enabled.value = true;
    f.session.flush();
    expect(f.writes.length).toBe(1);
    sessionStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    f.state.value.add("still usable");
    expect(f.session.flush).not.toThrow();
  } finally {
    f.scope.stop();
  }
});

test("workspace snapshots validate tab kinds and reject invalid panel sizes", () => {
  const value = {
    tabs: [
      { key: "README.md:file", path: "README.md", markdownMode: "source" },
      { key: "x:working", path: "x", staged: false },
      {
        key: `x:rev:${"a".repeat(40)}`,
        path: "x",
        scope: { kind: "commit", rev: "a".repeat(40) },
      },
    ],
    sections: [
      {
        id: `tree:commit:${"a".repeat(40)}`,
        title: "Файлы коммита @aaaaaaa",
        kind: "tree",
        params: { scope: { kind: "commit", rev: "a".repeat(40) } },
        closable: true,
      },
    ],
    activeKey: "x:working",
    section: "git",
    treeWidth: 200,
  };
  expect(workspaceSessionSchema.safeParse(value).success).toBe(true);
  expect(workspaceSessionSchema.safeParse({ ...value, treeWidth: -1 }).success).toBe(false);
  expect(workspaceSessionSchema.safeParse({ ...value, tabs: [null] }).success).toBe(false);
  expect(workspaceSessionSchema.safeParse({ ...value, sections: [{ id: "tree:x" }] }).success).toBe(
    false,
  );
});

test("continuous activity is persisted by maxWait without a quiet interval", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 10; i++) {
      f.state.value.add(`folder-${i}`);
      await delay(280);
    }
    expect(f.writes.length).toBe(1);
    expect(JSON.parse(f.values.get("project-a")).length >= 8).toBeTruthy();
  } finally {
    f.scope.stop();
  }
});

async function mobileWorkspace(saved, { mobile = true, terminals = true, install } = {}) {
  const { useWorkspaceSession } = await import("../modules/workspace/lib/workspace-session.ts");
  const { createDockLayout } = await import("../modules/dock/model/layout.ts");
  const values = new Map();
  if (saved) values.set("projector:workspace:v1:project", JSON.stringify(saved));
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const scope = effectScope();
  const ctx = {
    projectId: () => "project",
    persist: true,
    initialLayout: createDockLayout,
    tabs: ref([]),
    layout: ref(createDockLayout()),
    restoringSession: ref(false),
    activeKey: ref(""),
    section: ref("files"),
    sections: new Map([["files", {}]]),
    treeWidth: ref(undefined),
    sidebarHidden: ref(false),
    mobile: ref(mobile),
    mobileSurface: ref("editor"),
    terminals,
    ensureTab: () => undefined,
    openOptions: [],
    openFile: async (path, _line, _column, _staged, options) => {
      ctx.openOptions.push(options);
      ctx.tabs.value.push({ key: path, path });
      ctx.activeKey.value = path;
      return 1;
    },
    openCommitFile: async () => undefined,
    fileGeneration: () => 1,
    resetFiles: () => {},
    resetGit: () => {},
    reloadGit: () => {},
  };
  install?.(ctx);
  scope.run(() => {
    // Mirrors registerMobileCommands: activating a tab shows the editor.
    watch(ctx.activeKey, (key) => key && (ctx.mobileSurface.value = "editor"));
    useWorkspaceSession(ctx);
  });
  return { ctx, scope, values };
}
const savedSession = (mobileSurface) => ({
  tabs: [
    { key: "a.ts", path: "a.ts" },
    { key: "b.ts", path: "b.ts" },
  ],
  // Restoring tabs activates the last one; the saved active tab then changes activeKey once more.
  activeKey: "a.ts",
  section: "files",
  mobileSurface,
});

test("the mobile surface is saved and restored after restored tabs have taken their turn", async () => {
  const f = await mobileWorkspace(savedSession("files"));
  try {
    await delay(20);
    expect(f.ctx.tabs.value.map((tab) => tab.key)).toStrictEqual(["a.ts", "b.ts"]);
    expect(f.ctx.mobileSurface.value).toBe("files");
    f.ctx.mobileSurface.value = "terminal";
    await nextTick();
    window.dispatchEvent(new Event("beforeunload"));
    expect(JSON.parse(f.values.get("projector:workspace:v1:project")).mobileSurface).toBe(
      "terminal",
    );
  } finally {
    f.scope.stop();
  }
});

test("restored tabs open quietly so a stale one does not report an error", async () => {
  const f = await mobileWorkspace(savedSession("files"));
  try {
    await delay(20);
    expect(f.ctx.openOptions.length).toBe(2);
    expect(f.ctx.openOptions.every((options) => options?.quiet === true)).toBe(true);
  } finally {
    f.scope.stop();
  }
});

test("a saved terminal surface falls back without terminals; desktop and old sessions keep the editor", async () => {
  for (const [saved, options, expected] of [
    [savedSession("terminal"), { terminals: false }, "editor"],
    [savedSession("files"), { mobile: false }, "editor"],
    [{ ...savedSession("files"), mobileSurface: undefined }, {}, "editor"],
    [savedSession("terminal"), {}, "terminal"],
  ]) {
    const f = await mobileWorkspace(saved, options);
    try {
      await delay(20);
      expect(f.ctx.mobileSurface.value).toBe(expected);
    } finally {
      f.scope.stop();
    }
  }
});

test("MR tabs restore their saved diff version and reject a mismatched provider response", async () => {
  const { registerWorkspaceProfile } = await import("../modules/workspace-api/index.ts");
  const { createDiffOpeners } = await import("../modules/workspace/lib/open-diff-files.ts");
  const old = "a".repeat(40);
  const current = "b".repeat(40);
  const base = "c".repeat(40);
  const wrongBase = "d".repeat(40);
  const path = "app.ts";
  const key = `${path}:pull:7:${old}`;
  const requests = [];
  const unregister = registerWorkspaceProfile("project", {
    id: "mr-fixture",
    layout: "editor",
    providers: {
      files: {},
      pulls: {
        read(_action, params) {
          requests.push(params);
          return Promise.resolve({
            hash: params.head,
            baseSha: base,
            original: "before",
            modified: params.head === old ? "old version" : "current version",
          });
        },
      },
    },
  });
  let files;
  let failure;
  let generation = 0;
  const f = await mobileWorkspace(
    {
      activeKey: key,
      section: "files",
      tabs: [
        { key, path, pull: 7, commit: current },
        {
          key: `${path}:pull:7:${current}:${base}`,
          path,
          pull: 7,
          commit: current,
          pullBase: base,
        },
      ],
    },
    {
      install(ctx) {
        files = createDiffOpeners({
          ...ctx,
          selectTab: (id) => (ctx.activeKey.value = id),
          dropPreview() {},
          generation: () => generation,
          begin: () => ++generation,
          finish() {},
          fail(id, message) {
            failure = message;
            return id;
          },
        });
        ctx.fileGeneration = () => generation;
        ctx.openPullFile = files.openPullFile;
      },
    },
  );
  try {
    await expect.poll(() => f.ctx.restoringSession.value).toBe(false);
    expect(requests).toEqual([
      { number: "7", path, head: old },
      { number: "7", path, head: current, base },
    ]);
    expect(f.ctx.activeKey.value).toBe(key);
    expect(f.ctx.tabs.value.map((tab) => tab.content)).toEqual(["old version", "current version"]);
    await files.openPullFile(7, path, current, false, wrongBase);
    expect(f.ctx.tabs.value).toHaveLength(2);
    expect(failure).toContain("версия diff merge request недоступна");
  } finally {
    f.scope.stop();
    unregister();
  }
});
