import { expect, test } from "vite-plus/test";
import { dropPreviewExcept, opensAsPreview } from "../src/modules/workspace/lib/preview-tabs.ts";

const tab = (key, extra = {}) => ({ key, path: key, content: "", ...extra });

test("a pinned tab is never turned back into a preview", () => {
  expect(opensAsPreview(true)).toBe(true);
  expect(opensAsPreview(true, tab("a", { preview: true }))).toBe(true);
  expect(opensAsPreview(true, tab("a"))).toBe(false);
  expect(opensAsPreview(false, tab("a", { preview: true }))).toBe(false);
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
  expect(tabs.map((file) => file.key)).toStrictEqual(["pinned", "new"]);
  expect(released).toStrictEqual(["old"]);
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
  expect(tabs.map((file) => file.key)).toStrictEqual(["dirty", "saving", "new"]);
  expect(dirty.preview).toBe(false);
  expect(saving.preview).toBe(false);
});
