import assert from "node:assert/strict";
import { test } from "node:test";
import { effectScope, nextTick, ref } from "vue";
import { setTimeout as delay } from "node:timers/promises";
import {
  useSessionSnapshot,
  treeSessionSchema,
  workspaceSessionSchema,
} from "../src/modules/workspace/session.ts";

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
    assert.equal(f.writes.length, 0);
    await delay(700);
    assert.equal(f.writes.length, 1);
    assert.equal(JSON.parse(f.values.get("project-a")).length, 20);
    f.state.value = new Set(f.state.value);
    f.session.flush();
    assert.equal(f.writes.length, 1);
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
    assert.deepEqual(JSON.parse(f.values.get("project-a")), ["src/nested"]);
    f.state.value.add("docs");
    f.key.value = "project-b";
    assert.deepEqual(JSON.parse(f.values.get("project-a")), ["src/nested", "docs"]);
    f.state.value = new Set(["other"]);
    f.scope.stop();
    assert.deepEqual(JSON.parse(f.values.get("project-b")), ["other"]);
    await delay(700);
    assert.equal(f.writes.length, 3);
  } finally {
    f.scope.stop();
  }
});

test("restoration is not saved halfway; invalid and unavailable storage is ignored", () => {
  const f = fixture();
  try {
    f.values.set("project-a", "{broken");
    assert.equal(f.session.read(), undefined);
    f.values.set("project-a", "[123]");
    assert.equal(f.session.read(), undefined);
    f.values.set("project-a", '["src"]');
    assert.deepEqual(f.session.read(), ["src"]);
    f.enabled.value = false;
    f.state.value.add("restoring");
    f.session.flush();
    assert.equal(f.writes.length, 0);
    f.enabled.value = true;
    f.session.flush();
    assert.equal(f.writes.length, 1);
    sessionStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    f.state.value.add("still usable");
    assert.doesNotThrow(f.session.flush);
  } finally {
    f.scope.stop();
  }
});

test("workspace snapshots validate tab kinds and reject invalid panel sizes", () => {
  const value = {
    tabs: [
      { key: "README.md:file", path: "README.md", markdownMode: "source" },
      { key: "x:working", path: "x", staged: false },
    ],
    activeKey: "x:working",
    section: "git",
    treeWidth: 200,
  };
  assert.equal(workspaceSessionSchema.safeParse(value).success, true);
  assert.equal(workspaceSessionSchema.safeParse({ ...value, treeWidth: -1 }).success, false);
  assert.equal(workspaceSessionSchema.safeParse({ ...value, tabs: [null] }).success, false);
});

test("continuous activity is persisted by maxWait without a quiet interval", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 10; i++) {
      f.state.value.add(`folder-${i}`);
      await delay(280);
    }
    assert.equal(f.writes.length, 1);
    assert.ok(JSON.parse(f.values.get("project-a")).length >= 8);
  } finally {
    f.scope.stop();
  }
});
