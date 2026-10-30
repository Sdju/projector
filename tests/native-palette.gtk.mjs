import assert from "node:assert/strict";
import { test } from "node:test";
import Gtk from "gi:Gtk-4.0";
import { createApp, nextTick } from "@zede/vio";
import Palette from "../native/modules/desktop/Palette.vue";

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
