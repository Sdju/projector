import assert from "node:assert/strict";
import { test } from "node:test";
import { dropPreviewExcept, opensAsPreview } from "../src/modules/workspace/lib/preview-tabs.ts";

const tab = (key, extra = {}) => ({ key, path: key, content: "", ...extra });

test("a pinned tab is never turned back into a preview", () => {
  assert.equal(opensAsPreview(true), true);
  assert.equal(opensAsPreview(true, tab("a", { preview: true })), true);
  assert.equal(opensAsPreview(true, tab("a")), false);
  assert.equal(opensAsPreview(false, tab("a", { preview: true })), false);
});

test("a new preview replaces the previous one and keeps pinned tabs", () => {
  const released = [];
  const tabs = [tab("pinned"), tab("old", { preview: true }), tab("new", { preview: true })];
  dropPreviewExcept(
    tabs,
    "new",
    () => false,
    (file) => released.push(file.key),
  );
  assert.deepEqual(
    tabs.map((file) => file.key),
    ["pinned", "new"],
  );
  assert.deepEqual(released, ["old"]);
});

test("a modified or saving preview is pinned instead of dropped", () => {
  const dirty = tab("dirty", { preview: true });
  const saving = tab("saving", { preview: true, saving: true });
  const tabs = [dirty, saving, tab("new", { preview: true })];
  dropPreviewExcept(
    tabs,
    "new",
    (file) => file === dirty,
    () => {},
  );
  assert.deepEqual(
    tabs.map((file) => file.key),
    ["dirty", "saving", "new"],
  );
  assert.equal(dirty.preview, false);
  assert.equal(saving.preview, false);
});
