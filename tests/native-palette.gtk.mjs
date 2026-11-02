import assert from "node:assert/strict";
import { test } from "node:test";
import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import { createApp, nextTick } from "@zede/vio";
import Palette from "../native/modules/desktop/Palette.vue";
import { os } from "../core/modules/os/index.ts";

if (process.platform === "win32") await import("gi:GdkWin32-4.0");

Gtk.init();

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

await test("Projector palette uses the published renderer for native entry, search rows and cleanup", async () => {
  const windows = Gtk.Window.getToplevels();
  const before = windows.getNItems();
  const fetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, "http://palette.test");
    assert.equal(url.pathname, "/api/launcher/search");
    queries.push(url.searchParams.get("q"));
    return Response.json({
      items: [
        {
          id: "project:test",
          kind: "project",
          name: "External vio project",
          description: "",
          keywords: "",
          actions: [],
        },
      ],
    });
  };
  const app = createApp(Palette, { baseUrl: "http://palette.test", applicationIcon: () => null });
  const errors = [];
  app.config.errorHandler = (error) => errors.push(error);
  try {
    const controller = app.mount();
    const nodes = descendants(app.root);
    const window = nodes.find((node) => node.type === "window").widget;
    const entry = nodes.find((node) => node.type === "entry").widget;
    const list = nodes.find((node) => node.type === "list-box").widget;
    assert.equal(window.getTitle(), "Projector — поиск");
    assert.equal(windows.getNItems(), before + 1);
    entry.setText("external vio");
    const deadline = Date.now() + 3000;
    while (!list.getRowAtIndex(0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await nextTick();
    }
    assert.deepEqual(queries, ["external vio"]);
    assert.ok(list.getRowAtIndex(0), "search results become real GTK rows");
    const labels = descendants(app.root).filter((node) => node.type === "label" && node.widget);
    assert.ok(labels.some((node) => node.widget.getLabel() === "External vio project"));
    assert.equal(controller.hide(), true);
    assert.equal(window.getVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    app.unmount();
    globalThis.fetch = fetch;
  }
  assert.equal(app.root.children.length, 0);
  assert.equal(windows.getNItems(), before, "unmount destroys the palette window");
});

await test("palette hides after losing real window focus during the startup grace period", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [] });
  const context = GLib.MainContext.default();
  const pump = setInterval(() => {
    for (let step = 0; step < 64 && context.iteration(false); step++);
  }, 10);
  const app = createApp(Palette, { baseUrl: "http://palette.test", applicationIcon: () => null });
  const other = new Gtk.Window({ title: "Projector focus regression test" });
  const errors = [];
  app.config.errorHandler = (error) => errors.push(error);
  const waitFor = async (condition, message, timeout = 3000) => {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(condition(), message);
  };
  try {
    const controller = app.mount();
    const window = descendants(app.root).find((node) => node.type === "window").widget;
    // Warm the OS helper before measuring the two-second grace period.
    await controller.show();
    await waitFor(() => window.isActive(), "palette acquires real focus");
    controller.hide();
    const shownAt = Date.now();
    await controller.show();
    await waitFor(() => window.isActive(), "reopened palette is active");
    // Let show()'s 300ms raise finish before deliberately focusing another window.
    await new Promise((resolve) => setTimeout(resolve, 400));
    other.present();
    await os.windows.activateSurface(other.getSurface());
    await waitFor(
      () => other.isActive() && !window.isActive(),
      "focus moves to another GTK window",
    );
    assert.ok(Date.now() - shownAt < 2000, "focus was lost inside the grace period");
    assert.ok(window.getVisible(), "grace period postpones hiding");
    await waitFor(() => !window.getVisible(), "palette hides when the grace period expires");
    assert.deepEqual(errors, []);
  } finally {
    clearInterval(pump);
    app.unmount();
    other.destroy();
    globalThis.fetch = originalFetch;
    if (process.platform === "win32") {
      const { stopWindowHost } = await import("../core/modules/os/modules/windows/hwnd.ts");
      await stopWindowHost();
    }
  }
});
