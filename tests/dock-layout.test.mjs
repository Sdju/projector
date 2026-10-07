import { expect, test } from "vite-plus/test";
import {
  activatePanel,
  addPanel,
  createDockLayout,
  dockGroups,
  dockPanels,
  findDockGroup,
  groupOfPanel,
  movePanel,
  parseDockLayout,
  reconcileDock,
  removePanel,
  reorderPanels,
  replacePanel,
  serializeDockLayout,
  setGroupHidden,
  setSplitSizes,
  toggleMaximized,
} from "../src/modules/dock/model/layout.ts";

const sum = (values) => values.reduce((total, value) => total + value, 0);
function assertValid(layout) {
  const groups = dockGroups(layout);
  expect(
    groups.some((group) => group.id === layout.focused),
    "focused group exists",
  ).toBeTruthy();
  const panels = dockPanels(layout);
  expect(new Set(panels).size, "panel appears once").toBe(panels.length);
  const ids = new Set();
  const visit = (node) => {
    expect(!ids.has(node.id), `unique id ${node.id}`).toBeTruthy();
    ids.add(node.id);
    if (node.type === "split") {
      expect(node.children.length >= 2, "split has at least two children").toBeTruthy();
      expect(node.sizes.length).toBe(node.children.length);
      expect(Math.abs(sum(node.sizes) - 1) < 1e-9, "sizes sum to one").toBeTruthy();
      node.children.forEach(visit);
    } else expect(node.panels.includes(node.active) || !node.panels.length).toBeTruthy();
  };
  visit(layout.root);
}

test("default layout has editor and terminal groups", () => {
  const layout = createDockLayout();
  assertValid(layout);
  expect(dockGroups(layout).map((group) => group.role)).toStrictEqual(["editor", "terminal"]);
});

test("panels are added to a group, activated and reuse the same reference when unchanged", () => {
  let layout = addPanel(createDockLayout(), "a.ts", { groupId: "g1" });
  layout = addPanel(layout, "b.ts", { groupId: "g1" });
  expect(findDockGroup(layout, "g1").panels).toStrictEqual(["a.ts", "b.ts"]);
  expect(findDockGroup(layout, "g1").active).toBe("b.ts");
  expect(addPanel(layout, "b.ts", { groupId: "g1" })).toBe(layout);
  expect(activatePanel(layout, "b.ts")).toBe(layout);
  expect(activatePanel(layout, "missing")).toBe(layout);
  assertValid(layout);
});

test("dropping on an edge splits the group beside it", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b", "c"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "right" });
  assertValid(layout);
  const editor = groupOfPanel(layout, "a");
  const split = groupOfPanel(layout, "b");
  expect(editor.id).not.toBe(split.id);
  expect(editor.panels).toStrictEqual(["a", "c"]);
  expect(layout.focused).toBe(split.id);
  // The new group joins the existing row instead of nesting another split.
  expect(layout.root.type).toBe("split");
  expect(layout.root.children.length).toBe(3);
  expect(layout.root.direction).toBe("row");
});

test("splitting against the other direction nests a column", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "bottom" });
  assertValid(layout);
  const column = layout.root.children[0];
  expect(column.type).toBe("split");
  expect(column.direction).toBe("column");
  expect(column.children.map((child) => child.panels)).toStrictEqual([["a"], ["b"]]);
});

test("a group with one tab cannot be split by that tab", () => {
  const layout = addPanel(createDockLayout(), "a", { groupId: "g1" });
  expect(movePanel(layout, "a", { groupId: "g1", zone: "left" })).toBe(layout);
});

test("moving the last tab out removes a group that is not keepEmpty and collapses the split", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "a", { groupId: "g1" });
  layout = addPanel(layout, "b", { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "right" });
  const created = groupOfPanel(layout, "b").id;
  layout = movePanel(layout, "b", { groupId: "g1", zone: "center" });
  assertValid(layout);
  expect(findDockGroup(layout, created)).toBe(undefined);
  expect(groupOfPanel(layout, "b").panels).toStrictEqual(["a", "b"]);
  // keepEmpty groups survive emptiness.
  expect(findDockGroup(layout, "g2")).toBeTruthy();
});

test("moving between groups and reordering inside a group", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b", "c"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = movePanel(layout, "c", { groupId: "g2", zone: "center" });
  expect(findDockGroup(layout, "g2").panels).toStrictEqual(["c"]);
  expect(layout.focused).toBe("g2");
  layout = movePanel(layout, "a", { groupId: "g1", zone: "center", index: 2 });
  expect(findDockGroup(layout, "g1").panels).toStrictEqual(["b", "a"]);
  layout = reorderPanels(layout, "g1", ["a", "b"]);
  expect(findDockGroup(layout, "g1").panels).toStrictEqual(["a", "b"]);
  expect(reorderPanels(layout, "g1", ["a"])).toBe(layout);
  assertValid(layout);
});

test("closing the active tab activates a neighbour; closing everything keeps keepEmpty groups", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b", "c"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = activatePanel(layout, "b");
  layout = removePanel(layout, "b");
  expect(findDockGroup(layout, "g1").active).toBe("c");
  layout = removePanel(removePanel(layout, "a"), "c");
  expect(findDockGroup(layout, "g1").panels).toStrictEqual([]);
  expect(findDockGroup(layout, "g1")).toBeTruthy();
  assertValid(layout);
});

test("either half of a split terminal group disappears when its last tab closes or moves", () => {
  for (const original of [true, false]) {
    for (const action of ["close", "move", "reconcile"]) {
      let layout = addPanel(createDockLayout(), "terminal:1", { groupId: "g2" });
      layout = addPanel(layout, "terminal:2", { groupId: "g2" });
      layout = movePanel(layout, "terminal:2", { groupId: "g2", zone: "bottom" });
      const panel = original ? "terminal:1" : "terminal:2";
      const removed = groupOfPanel(layout, panel).id;
      layout =
        action === "move"
          ? movePanel(layout, panel, {
              groupId: groupOfPanel(layout, original ? "terminal:2" : "terminal:1").id,
            })
          : action === "reconcile"
            ? reconcileDock(layout, { ids: [], exists: (id) => id !== panel })
            : removePanel(layout, panel);
      expect(findDockGroup(layout, removed), `${action}: ${removed}`).toBe(undefined);
      expect(layout.root.direction, "empty nested split collapses").toBe("row");
      expect(dockGroups(layout).filter((group) => group.role === "terminal").length).toBe(1);
      for (const id of dockPanels(layout)) layout = removePanel(layout, id);
      expect(
        dockGroups(layout).filter((group) => group.role === "terminal").length,
        "last empty terminal placeholder survives",
      ).toBe(1);
      assertValid(layout);
    }
  }
});

test("reconcile repairs a saved split whose terminal group has no role", () => {
  let layout = addPanel(createDockLayout(), "terminal:1", { groupId: "g2" });
  layout = addPanel(layout, "terminal:2", { groupId: "g2" });
  layout = movePanel(layout, "terminal:2", { groupId: "g2", zone: "top" });
  const survivor = groupOfPanel(layout, "terminal:2");
  delete survivor.role;
  delete survivor.keepEmpty;
  findDockGroup(layout, "g2").panels = [];
  findDockGroup(layout, "g2").active = "";
  layout = parseDockLayout(serializeDockLayout(layout));
  layout = reconcileDock(layout, {
    ids: ["terminal:2"],
    exists: () => true,
    role: (id) => (id.startsWith("terminal:") ? "terminal" : "editor"),
  });
  expect(findDockGroup(layout, "g2")).toBe(undefined);
  expect(groupOfPanel(layout, "terminal:2").role).toBe("terminal");
  expect(groupOfPanel(layout, "terminal:2").keepEmpty).toBe(true);
  expect(layout.root.direction).toBe("row");
  assertValid(layout);
});

test("edge drop onto the whole dock creates a root-level group", () => {
  let layout = addPanel(createDockLayout(), "a", { groupId: "g1" });
  layout = addPanel(layout, "t", { zone: "bottom" });
  assertValid(layout);
  expect(layout.root.direction).toBe("column");
  expect(layout.root.children[1].panels).toStrictEqual(["t"]);
  expect(Math.abs(layout.root.sizes[1] - 0.35) < 1e-9).toBeTruthy();
});

test("hiding moves focus away, showing restores it, maximize is cleared with hidden groups", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "a", { groupId: "g1" });
  layout = addPanel(layout, "t", { groupId: "g2" });
  expect(layout.focused).toBe("g2");
  layout = toggleMaximized(layout, "g2");
  expect(layout.maximized).toBe("g2");
  layout = setGroupHidden(layout, "g2", true);
  expect(layout.focused).toBe("g1");
  expect(layout.maximized).toBe(undefined);
  expect(findDockGroup(layout, "g2").hidden).toBe(true);
  layout = activatePanel(layout, "t");
  expect(findDockGroup(layout, "g2").hidden).toBe(undefined);
  expect(layout.focused).toBe("g2");
  assertValid(layout);
});

test("split sizes are normalised and validated", () => {
  const layout = createDockLayout();
  const resized = setSplitSizes(layout, "s1", [3, 1]);
  expect(resized.root.sizes).toStrictEqual([0.75, 0.25]);
  expect(setSplitSizes(layout, "s1", [1])).toBe(layout);
  expect(setSplitSizes(layout, "missing", [1, 1])).toBe(layout);
});

test("replacePanel keeps position and activity", () => {
  let layout = addPanel(createDockLayout(), "old", { groupId: "g2" });
  layout = addPanel(layout, "other", { groupId: "g2" });
  layout = activatePanel(layout, "old");
  layout = replacePanel(layout, "old", "new");
  expect(findDockGroup(layout, "g2").panels).toStrictEqual(["new", "other"]);
  expect(findDockGroup(layout, "g2").active).toBe("new");
  expect(replacePanel(layout, "new", "other")).toBe(layout);
});

test("reconcile prunes vanished panels, ignores unknown sources and places new ones", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "file:a", { groupId: "g1" });
  layout = addPanel(layout, "terminal:1", { groupId: "g2" });
  const kept = reconcileDock(layout, {
    ids: ["file:a", "terminal:1"],
    exists: (panel) => (panel.startsWith("terminal:") ? undefined : true),
  });
  expect(kept).toBe(layout);
  const next = reconcileDock(layout, {
    ids: ["terminal:2", "file:b"],
    exists: (panel) => (panel === "file:a" ? false : undefined),
    place: (panel) => ({ groupId: panel.startsWith("terminal:") ? "g2" : "g1" }),
  });
  expect(findDockGroup(next, "g1").panels).toStrictEqual(["file:b"]);
  expect(findDockGroup(next, "g2").panels).toStrictEqual(["terminal:1", "terminal:2"]);
  expect(findDockGroup(next, "g2").active, "reconcile does not steal activity").toBe("terminal:1");
  assertValid(next);
});

test("layouts survive serialisation; hostile data does not throw", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "a", { groupId: "g1" });
  layout = addPanel(layout, "b", { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "bottom" });
  layout = setGroupHidden(layout, "g2", true);
  layout = toggleMaximized(layout, "g1");
  const stored = JSON.parse(JSON.stringify(serializeDockLayout(layout)));
  expect(stored.maximized).toBe(undefined);
  const restored = parseDockLayout(stored);
  expect(restored).toStrictEqual(serializeDockLayout(layout));

  for (const bad of [
    null,
    1,
    [],
    {},
    { root: null },
    { root: { type: "split", id: "s", direction: "diagonal", children: [] } },
    { root: { type: "group", id: "g", panels: "x" } },
  ])
    expect(parseDockLayout(bad)).toBe(undefined);

  const duplicated = parseDockLayout({
    root: {
      type: "split",
      id: "s1",
      direction: "row",
      sizes: [1, -5, "x"],
      children: [
        { type: "group", id: "g1", panels: ["a", "a", 7, "b"], active: "zzz" },
        { type: "group", id: "g1", panels: ["c"] },
        { type: "group", id: "g3", panels: ["b", "d"], hidden: true },
      ],
    },
    focused: "nope",
  });
  expect(duplicated).toBeTruthy();
  assertValid(duplicated);
  expect(dockPanels(duplicated)).toStrictEqual(["a", "b", "d"]);
  expect(findDockGroup(duplicated, "g1").active).toBe("a");

  let deep = { type: "group", id: "leaf", panels: ["x"] };
  for (let i = 0; i < 20; i++)
    deep = {
      type: "split",
      id: `n${i}`,
      direction: i % 2 ? "row" : "column",
      children: [deep, { type: "group", id: `l${i}`, panels: [] }],
    };
  const shallow = parseDockLayout({ root: deep });
  expect(!shallow || !dockPanels(shallow).includes("x"), "excessive depth is dropped").toBeTruthy();
});

test("mobile surfaces separate mixed panels without changing desktop splits or hidden groups", async () => {
  const { mobileDockSurfaces } = await import("../src/modules/dock/model/mobile-surfaces.ts");
  let layout = createDockLayout();
  layout = addPanel(layout, "a", { groupId: "g1", zone: "center" });
  layout = addPanel(layout, "terminal:1", { groupId: "g1", zone: "center" });
  layout = addPanel(layout, "b", { groupId: "g2", zone: "center" });
  layout = addPanel(layout, "terminal:2", { groupId: "g2", zone: "center" });
  layout = setGroupHidden(layout, "g2", true);
  layout = toggleMaximized(layout, "g1");
  const original = structuredClone(layout);
  const isTerminal = (id) => id.startsWith("terminal:");
  const last = { editor: "b", terminal: "terminal:2" };
  let surfaces = mobileDockSurfaces(layout, isTerminal, last);
  expect(surfaces[0]).toStrictEqual({ side: "editor", ids: ["a", "b"], active: "b" });
  expect(surfaces[1]).toStrictEqual({
    side: "terminal",
    ids: ["terminal:1", "terminal:2"],
    active: "terminal:1",
  });
  surfaces = mobileDockSurfaces(
    layout,
    isTerminal,
    { editor: "removed", terminal: "removed" },
    { editor: ["b", "removed", "a"], terminal: [] },
  );
  expect(surfaces[0].active).toBe("b");
  expect(surfaces[0].ids).toStrictEqual(["b", "a"]);
  expect(layout).toStrictEqual(original);
  expect(
    mobileDockSurfaces(createDockLayout(), isTerminal, last).map((item) => item.active),
  ).toStrictEqual(["", ""]);
});

test("tab reader lists panels and reads files, diffs, terminals and rejects unknown tabs", async () => {
  const { registerTabReader } = await import("../src/modules/workspace/lib/tab-reader.ts");
  const { createTabRegistry, defineTab } = await import("../src/modules/workspace-api/tabs.ts");
  const tabTypes = createTabRegistry([
    defineTab({
      id: "note",
      key: () => "note",
      path: () => "Note",
      title: () => "Note",
      read: () => ({ text: "from the kind", note: "own reader" }),
    }),
  ]);
  const commands = new Map();
  const files = new Map([
    ["a.ts", { key: "a.ts", path: "a.ts", content: "old", draft: "new" }],
    ["img", { key: "img", path: "p.png", content: "", image: "x" }],
    ["agent:chat", { key: "agent:chat", path: "Агент", content: "", virtual: "agent" }],
    ["note", { key: "note", path: "Note", content: "", virtual: "note" }],
  ]);
  const layout = { focused: "g1", root: {} };
  const group = {
    id: "g1",
    panels: ["a.ts", "img", "agent:chat", "note", "terminal:t1"],
    active: "a.ts",
  };
  const reads = [];
  registerTabReader({
    layout: () => layout,
    groups: () => [group],
    fileOf: (id) => files.get(id),
    tabTypes,
    terminalOf: (id) => (id === "terminal:t1" ? { id: "t1", status: "running" } : undefined),
    label: (id) => id,
    isDirty: (file) => file.draft !== undefined && file.draft !== file.content,
    readTerminal: async (id, lines) => (
      reads.push([id, lines]),
      { text: "0123456789", totalLines: 1, truncated: false }
    ),
    register: (id, _title, run) => commands.set(id, run),
  });
  const list = commands.get("ide.workbench.tabs.list")();
  expect(list.tabs.map((tab) => [tab.kind, tab.dirty])).toStrictEqual([
    ["file", true],
    ["image", false],
    ["agent", false],
    ["note", false],
    ["terminal", undefined],
  ]);
  const read = commands.get("ide.workbench.tab.read");
  expect((await read()).text).toBe("new");
  expect((await read({ id: "img" })).text).toBe(undefined);
  expect((await read({ id: "agent:chat" })).note).toBeTruthy();
  expect([(await read({ id: "note" })).text, (await read({ id: "note" })).note]).toStrictEqual([
    "from the kind",
    "own reader",
  ]);
  const tail = await read({ id: "terminal:t1", maxChars: 4, lines: 5 });
  expect([tail.text, tail.truncated, reads[0]]).toStrictEqual(["6789", true, ["t1", 5]]);
  await expect(read({ id: "missing" })).rejects.toThrow(/не найдена/);
});

test("tab reader prefers the live view readout over the kind's static reader", async () => {
  const { registerTabReader } = await import("../src/modules/workspace/lib/tab-reader.ts");
  const { createTabRegistry, defineTab } = await import("../src/modules/workspace-api/tabs.ts");
  const { registerTabReadout } = await import("../src/common/utilities/tab-readout.ts");
  const tabTypes = createTabRegistry([
    defineTab({
      id: "note",
      key: () => "note",
      path: () => "Note",
      title: () => "Note",
      read: () => ({ text: "static", note: "static note" }),
    }),
    defineTab({ id: "bare", key: () => "bare", path: () => "Bare", title: () => "Bare" }),
  ]);
  const commands = new Map();
  const files = new Map([
    ["note", { key: "note", path: "Note", content: "", virtual: "note" }],
    ["bare", { key: "bare", path: "Bare", content: "", virtual: "bare" }],
  ]);
  registerTabReader({
    layout: () => ({ focused: "g1", root: {} }),
    groups: () => [{ id: "g1", panels: ["note", "bare"], active: "note" }],
    fileOf: (id) => files.get(id),
    tabTypes,
    terminalOf: () => undefined,
    label: (id) => id,
    isDirty: () => false,
    readTerminal: async () => ({ text: "", totalLines: 0, truncated: false }),
    register: (id, _title, run) => commands.set(id, run),
  });
  const read = commands.get("ide.workbench.tab.read");
  // The mounted view publishes the live screen and wins over the kind's static reader.
  const disposeNote = registerTabReadout("note", () => ({
    text: "live screen",
    note: "live note",
  }));
  expect(await read({ id: "note" })).toMatchObject({ text: "live screen", note: "live note" });
  disposeNote();
  // Live text without a note keeps the kind's note.
  const disposePartial = registerTabReadout("note", () => ({ text: "only text" }));
  expect(await read({ id: "note" })).toMatchObject({ text: "only text", note: "static note" });
  disposePartial();
  // An unloaded live readout falls back to the static reader.
  const disposeEmpty = registerTabReadout("note", () => undefined);
  expect((await read({ id: "note" })).text).toBe("static");
  disposeEmpty();
  // A kind without a reader stays empty until its view publishes a snapshot.
  expect((await read({ id: "bare" })).note).toMatch(/нет текстового содержимого/);
  const disposeBare = registerTabReadout("bare", () => ({ text: "bare live" }));
  expect((await read({ id: "bare" })).text).toBe("bare live");
  disposeBare();
  expect((await read({ id: "bare" })).text).toBe(undefined);
});

test("nested readouts keep the tab owner over child views and survive their unmount", async () => {
  const { createRenderer, defineComponent, h, ref, nextTick } = await import("vue");
  const { provideTabReadout, readTabReadout, useTabReadout } =
    await import("../src/common/utilities/tab-readout.ts");
  // A minimal headless renderer exercises the real component lifecycle without a DOM.
  const node = () => ({});
  const renderer = createRenderer({
    patchProp: () => {},
    insert: () => {},
    remove: () => {},
    createElement: node,
    createText: node,
    createComment: node,
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    setScopeId: () => {},
    cloneNode: node,
    insertStaticContent: () => node(),
  });
  const key = "readout:lifecycle";
  const showChild = ref(true);
  const Child = defineComponent({
    setup() {
      useTabReadout(() => ({ text: "child" }));
      return () => null;
    },
  });
  const Owner = defineComponent({
    setup() {
      useTabReadout(() => ({ text: "owner", note: "owner note" }));
      return () => (showChild.value ? h(Child) : null);
    },
  });
  const Host = defineComponent({
    setup() {
      provideTabReadout(() => key);
      return () => h(Owner);
    },
  });
  const app = renderer.createApp(Host);
  app.mount(node());
  // The tab's own view (owner) wins over a nested section's readout.
  expect(readTabReadout(key)).toStrictEqual({ text: "owner", note: "owner note" });
  // Unmounting the nested view restores the owner instead of dropping the readout.
  showChild.value = false;
  await nextTick();
  expect(readTabReadout(key)).toStrictEqual({ text: "owner", note: "owner note" });
  app.unmount();
  expect(readTabReadout(key)).toBe(undefined);
});

test("a nested readout is used only while the owner has nothing to say", async () => {
  const { readTabReadout, registerTabReadout } =
    await import("../src/common/utilities/tab-readout.ts");
  const key = "readout:fallback";
  const disposeOwner = registerTabReadout(key, () => undefined);
  const disposeNested = registerTabReadout(key, () => ({ text: "nested" }));
  expect(readTabReadout(key)).toStrictEqual({ text: "nested" });
  disposeNested();
  expect(readTabReadout(key)).toBe(undefined);
  disposeOwner();
  expect(readTabReadout(key)).toBe(undefined);
});
