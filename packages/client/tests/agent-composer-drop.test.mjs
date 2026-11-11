import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { createRenderer, shallowRef } from "vue";

vi.mock("../modules/agent/modules/composer/lib/editing.ts", () => ({
  insertDropped: (_view, chips, at) => {
    inserted.push({ chips, at });
  },
}));

const inserted = [];
const { useComposerDrop } = await import("../modules/agent/modules/composer/lib/drop.ts");
const { chatDropHandlers } = await import("../modules/agent/lib/chat-drop.ts");

function stubWindow() {
  if (typeof window !== "undefined" && window.addEventListener) return;
  const previous = globalThis.window;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  onTestFinished(() => {
    globalThis.window = previous;
  });
}

function mountHook(setup) {
  stubWindow();
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
  let api;
  const app = renderer.createApp({
    setup() {
      api = setup();
      return () => null;
    },
  });
  app.mount({});
  onTestFinished(() => app.unmount());
  return api;
}

function dragEvent(data, relatedTarget = null) {
  return {
    dataTransfer: data,
    currentTarget: { contains: (node) => node === relatedTarget },
    relatedTarget,
    preventDefault() {},
    stopPropagation() {},
  };
}

function treeDrop(path = "src/a.ts") {
  return {
    types: ["application/x-projector-tree-entry"],
    files: [],
    items: [],
    getData(type) {
      return type === "application/x-projector-tree-entry"
        ? JSON.stringify({ projectId: "p", path })
        : "";
    },
  };
}

test("a chat drop highlights the composer and freezes the caret before drop", () => {
  const calls = [];
  const target = {
    acceptsDrag: (data) => !!data,
    dropData: (data) => {
      calls.push(["drop", data]);
      return true;
    },
    beginDrag: () => calls.push(["begin"]),
    endDrag: () => calls.push(["end"]),
  };
  const chatDrop = mountHook(() => chatDropHandlers(() => target));
  const data = treeDrop();
  chatDrop.dragenter(dragEvent(data));
  expect(chatDrop.over.value).toBe(true);
  expect(calls).toEqual([["begin"]]);
  chatDrop.drop(dragEvent(data));
  expect(chatDrop.over.value).toBe(false);
  expect(calls).toEqual([["begin"], ["drop", data], ["end"]]);
});

test("an unfocused editor keeps the last typing caret if selection jumps to the start", () => {
  inserted.length = 0;
  const view = shallowRef({
    state: { doc: { length: 11 }, selection: { main: { head: 6 } } },
    hasFocus: true,
    focus() {},
  });
  const drop = mountHook(() =>
    useComposerDrop({
      projectId: () => "p",
      view,
      onFail() {},
    }),
  );
  drop.rememberCaret();
  view.value.hasFocus = false;
  view.value.state.selection.main.head = 0;
  drop.rememberCaret();
  drop.beginDrag();
  expect(drop.dropData(treeDrop())).toBe(true);
  expect(inserted).toEqual([{ chips: [{ type: "file", path: "src/a.ts" }], at: 6 }]);
});

test("dropped files go at the snapshotted caret after the selection jumps to the start", () => {
  inserted.length = 0;
  const view = shallowRef({
    state: { doc: { length: 11 }, selection: { main: { head: 6 } } },
    hasFocus: true,
    focus() {},
  });
  const drop = mountHook(() =>
    useComposerDrop({
      projectId: () => "p",
      view,
      onFail() {},
    }),
  );
  drop.rememberCaret();
  drop.beginDrag();
  view.value.state.selection.main.head = 0;
  expect(drop.dropData(treeDrop())).toBe(true);
  expect(inserted).toEqual([{ chips: [{ type: "file", path: "src/a.ts" }], at: 6 }]);
});

test("leaving the chat without dropping unfreezes the caret", () => {
  const calls = [];
  const target = {
    acceptsDrag: () => true,
    dropData: () => true,
    beginDrag: () => calls.push("begin"),
    endDrag: () => calls.push("end"),
  };
  const chatDrop = mountHook(() => chatDropHandlers(() => target));
  const root = { contains: () => false };
  const event = dragEvent(treeDrop());
  event.currentTarget = root;
  chatDrop.dragenter(event);
  chatDrop.dragleave(event);
  expect(chatDrop.over.value).toBe(false);
  expect(calls).toEqual(["begin", "end"]);
});
