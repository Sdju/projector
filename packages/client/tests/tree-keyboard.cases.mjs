import { expect, test } from "vite-plus/test";
import { ref } from "vue";
import { useTreeKeyboard } from "../modules/workspace/modules/tree/lib/tree-keyboard.ts";
import { createTreeSelection } from "../modules/workspace/modules/tree/lib/tree-selection.ts";

function row(path, { directory = false, more = false } = {}) {
  return {
    dataset: more ? { treeMore: path } : path === undefined ? {} : { path },
    focused: false,
    focus() {
      this.focused = true;
    },
    scrollIntoView() {},
    getAttribute(name) {
      return name === "aria-expanded" && directory ? "false" : null;
    },
  };
}

function setup(rows) {
  const opened = [];
  const toggled = [];
  const treeCommands = {
    scope: { activate() {} },
    keydown() {},
    run(id, args) {
      opened.push([id, args]);
    },
  };
  const keys = useTreeKeyboard({
    tree: ref({
      querySelectorAll(selector) {
        if (selector === "button[data-path]")
          return rows.filter((row) => row.dataset.path !== undefined);
        return rows.filter(
          (row) => row.dataset.path !== undefined || row.dataset.treeMore !== undefined,
        );
      },
    }),
    selection: createTreeSelection(),
    expanded: ref(new Set()),
    busy: ref(false),
    contextEntry: ref(),
    treeCommands,
    toggle: (path) => toggled.push(path),
  });
  return { keys, opened, toggled };
}

const key = (name, target) => ({
  key: name,
  target,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  preventDefault() {},
});

const treeEntry = (path, directory = false) => ({ path, name: path, directory });

// The component checks `event.target instanceof Element`; Node has no DOM, so provide the
// constructor for the duration of one test and restore the global afterwards.
function withElement(run) {
  const had = "Element" in globalThis;
  const previous = globalThis.Element;
  globalThis.Element = class Element {};
  try {
    run();
  } finally {
    if (had) globalThis.Element = previous;
    else delete globalThis.Element;
  }
}

test("arrows preview the file under the new focus and skip directories", () =>
  withElement(() => {
    const rows = [row("a.ts"), row("src", { directory: true }), row("src/b.ts")];
    const { keys, opened } = setup(rows);

    keys.entryKey(key("ArrowDown", rows[0]), treeEntry("a.ts"));
    expect(opened).toStrictEqual([]);
    expect(rows[1].focused).toBe(true);

    keys.entryKey(key("ArrowDown", rows[1]), treeEntry("src", true));
    expect(opened).toStrictEqual([["ide.fileTree.file.open", { path: "src/b.ts" }]]);
    expect(rows[2].focused).toBe(true);
  }));

test("pressing an arrow at an edge does not reopen the same file", () =>
  withElement(() => {
    const rows = [row("a.ts"), row("b.ts")];
    const { keys, opened } = setup(rows);

    keys.entryKey(key("ArrowDown", rows[0]), treeEntry("a.ts"));
    keys.entryKey(key("ArrowDown", rows[1]), treeEntry("b.ts"));
    expect(opened).toStrictEqual([["ide.fileTree.file.open", { path: "b.ts" }]]);
  }));

test("expanding a directory keeps previews for files only, and End previews the last file", () =>
  withElement(() => {
    const rows = [row("src", { directory: true }), row("src/a.ts"), row("src/b.ts")];
    const { keys, opened, toggled } = setup(rows);

    keys.entryKey(key("ArrowRight", rows[0]), treeEntry("src", true));
    expect(toggled).toStrictEqual(["src"]);
    expect(opened).toStrictEqual([]);

    keys.entryKey(key("End", rows[0]), treeEntry("src", true));
    expect(opened).toStrictEqual([["ide.fileTree.file.open", { path: "src/b.ts" }]]);
  }));

test("the next-page row has no preview", () =>
  withElement(() => {
    const rows = [row("a.ts"), row("", { more: true })];
    const { keys, opened } = setup(rows);

    keys.entryKey(key("ArrowDown", rows[0]), treeEntry("a.ts"));
    expect(opened).toStrictEqual([]);
    expect(rows[1].focused).toBe(true);
  }));
