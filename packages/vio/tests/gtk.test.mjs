import assert from "node:assert/strict";
import { test } from "node:test";
import Gtk from "gi:Gtk-4.0";
import {
  createApp,
  h,
  ref,
  nextTick,
  VWindow,
  VBox,
  VListBox,
  VListBoxRow,
  VLabel,
  VButton,
  installCss,
} from "vio";
import Fixture from "./Fixture.vue";

Gtk.init();
const children = (widget) => {
  const result = [];
  for (let child = widget.getFirstChild(); child; child = child.getNextSibling())
    result.push(child);
  return result;
};

await test("SFC expose, controlled entry and scoped CSS work with real GTK widgets", async () => {
  const app = createApp(Fixture);
  const controller = app.mount();
  try {
    assert.equal(controller.text, "initial");
    const window = app.root.children[0].widget;
    const box = window.getChild();
    const label = children(box)[1];
    assert.equal(label.getLabel(), "initial · 0");
    assert.ok(
      label.getCssClasses().some((name) => name.startsWith("vio-")),
      "scope id is a GTK class",
    );
    controller.entry.widget.setText("native edit");
    await nextTick();
    assert.equal(controller.text, "native edit");
    assert.equal(label.getLabel(), "native edit · 0");
    controller.text = "controlled edit";
    await nextTick();
    assert.equal(controller.entry.widget.getText(), "controlled edit");
    controller.count = 2;
    await nextTick();
    assert.equal(label.getLabel(), "controlled edit · 2");
  } finally {
    app.unmount();
  }
  assert.equal(app.root.children.length, 0);
});

await test("keyed GTK list rows move without losing native identity; selection tracks the final tree", async () => {
  const items = ref(["a", "b", "c"]);
  const selected = ref(1);
  const app = createApp({
    setup: () => () =>
      h(VWindow, null, {
        default: () =>
          h(
            VListBox,
            { selected: selected.value },
            {
              default: () =>
                items.value.map((key) =>
                  h(
                    VListBoxRow,
                    { key },
                    { default: () => h(VLabel, null, { default: () => key }) },
                  ),
                ),
            },
          ),
      }),
  });
  app.mount();
  try {
    const list = app.root.children[0].widget.getChild();
    const original = new Map(children(list).map((row) => [row.getChild().getLabel(), row]));
    items.value = ["c", "a", "d", "b"];
    selected.value = 3;
    await nextTick();
    assert.deepEqual(
      children(list).map((row) => row.getChild().getLabel()),
      items.value,
    );
    for (const key of ["a", "b", "c"])
      assert.equal(
        children(list).find((row) => row.getChild().getLabel() === key),
        original.get(key),
      );
    assert.equal(list.getSelectedRow().getChild().getLabel(), "b");
    items.value = ["b"];
    selected.value = 0;
    await nextTick();
    assert.equal(list.getSelectedRow(), original.get("b"));
  } finally {
    app.unmount();
  }
});

await test("keyed GTK box widgets retain identity and classes/properties reset when bindings are removed", async () => {
  const keys = ref(["a", "b", "c"]);
  const styled = ref(true);
  const app = createApp({
    setup: () => () =>
      h(VWindow, null, {
        default: () =>
          h(VBox, null, {
            default: () =>
              keys.value.map((key) =>
                h(
                  VButton,
                  { key, ...(styled.value ? { class: "custom", sensitive: false } : {}) },
                  { default: () => key },
                ),
              ),
          }),
      }),
  });
  app.mount();
  try {
    const box = app.root.children[0].widget.getChild();
    const original = children(box);
    keys.value = ["c", "a", "b"];
    styled.value = false;
    await nextTick();
    assert.deepEqual(children(box), [original[2], original[0], original[1]]);
    for (const button of children(box)) {
      assert.equal(button.getSensitive(), true);
      assert.equal(button.hasCssClass("custom"), false);
    }
  } finally {
    app.unmount();
  }
});

await test("invalid GTK CSS produces a useful error instead of silently applying half a stylesheet", () => {
  assert.throws(() => installCss("label { this-is-not-a-gtk-property: 42; }"), /invalid GTK CSS/);
});
