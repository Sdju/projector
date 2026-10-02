import assert from "node:assert/strict";
import { test } from "node:test";
import { h, ref, shallowRef, nextTick, Fragment, createTextVNode, createCommentVNode, onUnmounted, watchEffect } from "@vue/runtime-core";
import { createVioRenderer } from "../dist/core.mjs";

function fixture() {
  const records = [];
  const make = type => { const widget = { type, children: [], parent: null, props: {}, text: "", signals: new Map(), disposed: false }; records.push(widget); return widget; };
  const driver = {
    create: make,
    createText: text => Object.assign(make("label"), { text }),
    insert(node, parent, before) {
      const widget = node.widget;
      if (widget.parent) widget.parent.children.splice(widget.parent.children.indexOf(widget), 1);
      widget.parent = parent.widget;
      const siblings = parent.widget.children;
      siblings.splice(before ? siblings.indexOf(before) : siblings.length, 0, widget);
    },
    remove(node, parent) { parent.widget.children.splice(parent.widget.children.indexOf(node.widget), 1); node.widget.parent = null; },
    patchProp(node, key, _previous, value) { node.widget.props[key] = value; if (key === "text") node.widget.signals.get("changed")?.(); },
    setText: (node, text) => { node.widget.text = text; },
    setElementText(node, text) { if (!["label", "button"].includes(node.type)) return false; node.widget.text = text; return true; },
    connect(node, signal, callback) { assert.equal(node.widget.signals.has(signal), false, "one native connection per event"); node.widget.signals.set(signal, callback); return () => node.widget.signals.delete(signal); },
    setScopeId: () => {},
    dispose: node => { if (node.widget) node.widget.disposed = true; },
  };
  const renderer = createVioRenderer(driver);
  const container = make("root");
  const root = renderer.createRoot(container);
  return { ...renderer, root, container, records };
}

await test("keyed Vue updates move existing native objects and dispose only removed rows", async () => {
  const f = fixture();
  const rows = ref(["a", "b", "c"]);
  const app = f.createApp({ setup: () => () => h("box", null, rows.value.map(key => h("button", { key }, key))) });
  app.mount(f.root);
  const box = f.container.children[0];
  const original = new Map(box.children.map(widget => [widget.text, widget]));
  rows.value = ["c", "a", "d", "b"];
  await nextTick();
  assert.deepEqual(box.children.map(widget => widget.text), rows.value);
  for (const key of ["a", "b", "c"]) assert.equal(box.children.find(widget => widget.text === key), original.get(key));
  rows.value = ["b", "d"];
  await nextTick();
  assert.deepEqual(box.children.map(widget => widget.text), rows.value);
  assert.equal(original.get("a").disposed, true);
  assert.equal(original.get("b").disposed, false);
  app.unmount();
  assert.equal(f.container.children.length, 0);
});

await test("fragments, conditional components, slots and text anchors preserve physical order", async () => {
  const f = fixture();
  const enabled = ref(true);
  const text = ref("hello");
  const Slot = { setup: (_props, { slots }) => () => h(Fragment, null, slots.default()) };
  const app = f.createApp({ setup: () => () => h("box", null, [
    createTextVNode(""), h(Slot, null, { default: () => [h("label", null, text.value), enabled.value ? h("button", null, "conditional") : createCommentVNode("hidden")] }),
    h("label", null, "tail"),
  ]) });
  app.mount(f.root);
  const box = f.container.children[0];
  assert.deepEqual(box.children.map(widget => widget.text), ["hello", "conditional", "tail"]);
  enabled.value = false; text.value = "updated";
  await nextTick();
  assert.deepEqual(box.children.map(widget => widget.text), ["updated", "tail"]);
  enabled.value = true;
  await nextTick();
  assert.deepEqual(box.children.map(widget => widget.text), ["updated", "conditional", "tail"]);
  app.unmount();
});

await test("signals retain return values, replace callbacks, support once and disconnect on unmount", async () => {
  const f = fixture();
  const calls = [];
  const handler = shallowRef(() => { calls.push("first"); return true; });
  const app = f.createApp({ setup: () => () => h("button", { onClicked: handler.value, onKeyPressedOnce: () => { calls.push("once"); return true; } }) });
  app.mount(f.root);
  const button = f.container.children[0];
  const connection = button.signals.get("clicked");
  assert.equal(connection(), true);
  handler.value = () => { calls.push("second"); return false; };
  await nextTick();
  assert.equal(button.signals.get("clicked"), connection);
  assert.equal(connection(), false);
  assert.equal(button.signals.get("key-pressed")(), true);
  assert.equal(button.signals.get("key-pressed")(), undefined);
  assert.deepEqual(calls, ["first", "second", "once"]);
  app.unmount();
  assert.equal(button.signals.size, 0);
});

await test("controlled properties do not feed back through native changed signals; Vue effects stop on unmount", async () => {
  const f = fixture();
  const text = ref("initial");
  let changes = 0, effects = 0, unmounted = 0;
  const app = f.createApp({ setup() {
    watchEffect(() => { text.value; effects++; });
    onUnmounted(() => { unmounted++; });
    return () => h("entry", { onChanged: () => { changes++; }, text: text.value });
  } });
  app.mount(f.root);
  const entry = f.container.children[0];
  assert.equal(changes, 0);
  text.value = "controlled";
  await nextTick();
  assert.equal(changes, 0);
  entry.signals.get("changed")();
  assert.equal(changes, 1);
  app.unmount();
  const count = effects;
  text.value = "after unmount";
  await nextTick();
  assert.equal(effects, count);
  assert.equal(unmounted, 1);
  assert.equal(entry.signals.size, 0);
});

await test("native event errors use the Vue app error handler", () => {
  const f = fixture();
  const errors = [];
  const app = f.createApp({ render: () => h("button", { onClicked: () => { throw new Error("expected"); } }) });
  app.config.errorHandler = error => errors.push(error.message);
  app.mount(f.root);
  f.container.children[0].signals.get("clicked")();
  assert.deepEqual(errors, ["expected"]);
  app.unmount();
});
