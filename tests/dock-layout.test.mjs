import assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.ok(groups.some((group) => group.id === layout.focused), "focused group exists");
  const panels = dockPanels(layout);
  assert.equal(new Set(panels).size, panels.length, "panel appears once");
  const ids = new Set();
  const visit = (node) => {
    assert.ok(!ids.has(node.id), `unique id ${node.id}`);
    ids.add(node.id);
    if (node.type === "split") {
      assert.ok(node.children.length >= 2, "split has at least two children");
      assert.equal(node.sizes.length, node.children.length);
      assert.ok(Math.abs(sum(node.sizes) - 1) < 1e-9, "sizes sum to one");
      node.children.forEach(visit);
    } else assert.ok(node.panels.includes(node.active) || !node.panels.length);
  };
  visit(layout.root);
}

test("default layout has editor and terminal groups", () => {
  const layout = createDockLayout();
  assertValid(layout);
  assert.deepEqual(
    dockGroups(layout).map((group) => group.role),
    ["editor", "terminal"],
  );
});

test("panels are added to a group, activated and reuse the same reference when unchanged", () => {
  let layout = addPanel(createDockLayout(), "a.ts", { groupId: "g1" });
  layout = addPanel(layout, "b.ts", { groupId: "g1" });
  assert.deepEqual(findDockGroup(layout, "g1").panels, ["a.ts", "b.ts"]);
  assert.equal(findDockGroup(layout, "g1").active, "b.ts");
  assert.equal(addPanel(layout, "b.ts", { groupId: "g1" }), layout);
  assert.equal(activatePanel(layout, "b.ts"), layout);
  assert.equal(activatePanel(layout, "missing"), layout);
  assertValid(layout);
});

test("dropping on an edge splits the group beside it", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b", "c"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "right" });
  assertValid(layout);
  const editor = groupOfPanel(layout, "a");
  const split = groupOfPanel(layout, "b");
  assert.notEqual(editor.id, split.id);
  assert.deepEqual(editor.panels, ["a", "c"]);
  assert.equal(layout.focused, split.id);
  // The new group joins the existing row instead of nesting another split.
  assert.equal(layout.root.type, "split");
  assert.equal(layout.root.children.length, 3);
  assert.equal(layout.root.direction, "row");
});

test("splitting against the other direction nests a column", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "bottom" });
  assertValid(layout);
  const column = layout.root.children[0];
  assert.equal(column.type, "split");
  assert.equal(column.direction, "column");
  assert.deepEqual(
    column.children.map((child) => child.panels),
    [["a"], ["b"]],
  );
});

test("a group with one tab cannot be split by that tab", () => {
  const layout = addPanel(createDockLayout(), "a", { groupId: "g1" });
  assert.equal(movePanel(layout, "a", { groupId: "g1", zone: "left" }), layout);
});

test("moving the last tab out removes a group that is not keepEmpty and collapses the split", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "a", { groupId: "g1" });
  layout = addPanel(layout, "b", { groupId: "g1" });
  layout = movePanel(layout, "b", { groupId: "g1", zone: "right" });
  const created = groupOfPanel(layout, "b").id;
  layout = movePanel(layout, "b", { groupId: "g1", zone: "center" });
  assertValid(layout);
  assert.equal(findDockGroup(layout, created), undefined);
  assert.deepEqual(groupOfPanel(layout, "b").panels, ["a", "b"]);
  // keepEmpty groups survive emptiness.
  assert.ok(findDockGroup(layout, "g2"));
});

test("moving between groups and reordering inside a group", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b", "c"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = movePanel(layout, "c", { groupId: "g2", zone: "center" });
  assert.deepEqual(findDockGroup(layout, "g2").panels, ["c"]);
  assert.equal(layout.focused, "g2");
  layout = movePanel(layout, "a", { groupId: "g1", zone: "center", index: 2 });
  assert.deepEqual(findDockGroup(layout, "g1").panels, ["b", "a"]);
  layout = reorderPanels(layout, "g1", ["a", "b"]);
  assert.deepEqual(findDockGroup(layout, "g1").panels, ["a", "b"]);
  assert.equal(reorderPanels(layout, "g1", ["a"]), layout);
  assertValid(layout);
});

test("closing the active tab activates a neighbour; closing everything keeps keepEmpty groups", () => {
  let layout = createDockLayout();
  for (const name of ["a", "b", "c"]) layout = addPanel(layout, name, { groupId: "g1" });
  layout = activatePanel(layout, "b");
  layout = removePanel(layout, "b");
  assert.equal(findDockGroup(layout, "g1").active, "c");
  layout = removePanel(removePanel(layout, "a"), "c");
  assert.deepEqual(findDockGroup(layout, "g1").panels, []);
  assert.ok(findDockGroup(layout, "g1"));
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
      layout = action === "move"
        ? movePanel(layout, panel, { groupId: groupOfPanel(layout, original ? "terminal:2" : "terminal:1").id })
        : action === "reconcile"
          ? reconcileDock(layout, { ids: [], exists: (id) => id !== panel })
          : removePanel(layout, panel);
      assert.equal(findDockGroup(layout, removed), undefined, `${action}: ${removed}`);
      assert.equal(layout.root.direction, "row", "empty nested split collapses");
      assert.equal(dockGroups(layout).filter((group) => group.role === "terminal").length, 1);
      for (const id of dockPanels(layout)) layout = removePanel(layout, id);
      assert.equal(dockGroups(layout).filter((group) => group.role === "terminal").length, 1, "last empty terminal placeholder survives");
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
    ids: ["terminal:2"], exists: () => true,
    role: (id) => id.startsWith("terminal:") ? "terminal" : "editor",
  });
  assert.equal(findDockGroup(layout, "g2"), undefined);
  assert.equal(groupOfPanel(layout, "terminal:2").role, "terminal");
  assert.equal(groupOfPanel(layout, "terminal:2").keepEmpty, true);
  assert.equal(layout.root.direction, "row");
  assertValid(layout);
});

test("edge drop onto the whole dock creates a root-level group", () => {
  let layout = addPanel(createDockLayout(), "a", { groupId: "g1" });
  layout = addPanel(layout, "t", { zone: "bottom" });
  assertValid(layout);
  assert.equal(layout.root.direction, "column");
  assert.deepEqual(layout.root.children[1].panels, ["t"]);
  assert.ok(Math.abs(layout.root.sizes[1] - 0.35) < 1e-9);
});

test("hiding moves focus away, showing restores it, maximize is cleared with hidden groups", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "a", { groupId: "g1" });
  layout = addPanel(layout, "t", { groupId: "g2" });
  assert.equal(layout.focused, "g2");
  layout = toggleMaximized(layout, "g2");
  assert.equal(layout.maximized, "g2");
  layout = setGroupHidden(layout, "g2", true);
  assert.equal(layout.focused, "g1");
  assert.equal(layout.maximized, undefined);
  assert.equal(findDockGroup(layout, "g2").hidden, true);
  layout = activatePanel(layout, "t");
  assert.equal(findDockGroup(layout, "g2").hidden, undefined);
  assert.equal(layout.focused, "g2");
  assertValid(layout);
});

test("split sizes are normalised and validated", () => {
  const layout = createDockLayout();
  const resized = setSplitSizes(layout, "s1", [3, 1]);
  assert.deepEqual(resized.root.sizes, [0.75, 0.25]);
  assert.equal(setSplitSizes(layout, "s1", [1]), layout);
  assert.equal(setSplitSizes(layout, "missing", [1, 1]), layout);
});

test("replacePanel keeps position and activity", () => {
  let layout = addPanel(createDockLayout(), "old", { groupId: "g2" });
  layout = addPanel(layout, "other", { groupId: "g2" });
  layout = activatePanel(layout, "old");
  layout = replacePanel(layout, "old", "new");
  assert.deepEqual(findDockGroup(layout, "g2").panels, ["new", "other"]);
  assert.equal(findDockGroup(layout, "g2").active, "new");
  assert.equal(replacePanel(layout, "new", "other"), layout);
});

test("reconcile prunes vanished panels, ignores unknown sources and places new ones", () => {
  let layout = createDockLayout();
  layout = addPanel(layout, "file:a", { groupId: "g1" });
  layout = addPanel(layout, "terminal:1", { groupId: "g2" });
  const kept = reconcileDock(layout, {
    ids: ["file:a", "terminal:1"],
    exists: (panel) => (panel.startsWith("terminal:") ? undefined : true),
  });
  assert.equal(kept, layout);
  const next = reconcileDock(layout, {
    ids: ["terminal:2", "file:b"],
    exists: (panel) => (panel === "file:a" ? false : undefined),
    place: (panel) => ({ groupId: panel.startsWith("terminal:") ? "g2" : "g1" }),
  });
  assert.deepEqual(findDockGroup(next, "g1").panels, ["file:b"]);
  assert.deepEqual(findDockGroup(next, "g2").panels, ["terminal:1", "terminal:2"]);
  assert.equal(findDockGroup(next, "g2").active, "terminal:1", "reconcile does not steal activity");
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
  assert.equal(stored.maximized, undefined);
  const restored = parseDockLayout(stored);
  assert.deepEqual(restored, serializeDockLayout(layout));

  for (const bad of [
    null,
    1,
    [],
    {},
    { root: null },
    { root: { type: "split", id: "s", direction: "diagonal", children: [] } },
    { root: { type: "group", id: "g", panels: "x" } },
  ])
    assert.equal(parseDockLayout(bad), undefined);

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
  assert.ok(duplicated);
  assertValid(duplicated);
  assert.deepEqual(dockPanels(duplicated), ["a", "b", "d"]);
  assert.equal(findDockGroup(duplicated, "g1").active, "a");

  let deep = { type: "group", id: "leaf", panels: ["x"] };
  for (let i = 0; i < 20; i++)
    deep = { type: "split", id: `n${i}`, direction: i % 2 ? "row" : "column", children: [deep, { type: "group", id: `l${i}`, panels: [] }] };
  const shallow = parseDockLayout({ root: deep });
  assert.ok(!shallow || !dockPanels(shallow).includes("x"), "excessive depth is dropped");
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
  assert.deepEqual(surfaces[0], { side: "editor", ids: ["a", "b"], active: "b" });
  assert.deepEqual(surfaces[1], { side: "terminal", ids: ["terminal:1", "terminal:2"], active: "terminal:1" });
  surfaces = mobileDockSurfaces(layout, isTerminal, { editor: "removed", terminal: "removed" },
    { editor: ["b", "removed", "a"], terminal: [] });
  assert.equal(surfaces[0].active, "b");
  assert.deepEqual(surfaces[0].ids, ["b", "a"]);
  assert.deepEqual(layout, original);
  assert.deepEqual(mobileDockSurfaces(createDockLayout(), isTerminal, last).map((item) => item.active), ["", ""]);
});

test("tab reader lists panels and reads files, diffs, terminals and rejects unknown tabs", async () => {
  const { registerTabReader } = await import("../src/modules/workspace/lib/tab-reader.ts");
  const commands = new Map();
  const files = new Map([
    ["a.ts", { key: "a.ts", path: "a.ts", content: "old", draft: "new" }],
    ["img", { key: "img", path: "p.png", content: "", image: "x" }],
    ["agent:chat", { key: "agent:chat", path: "Агент", content: "", virtual: "agent" }],
  ]);
  const layout = { focused: "g1", root: {} };
  const group = { id: "g1", panels: ["a.ts", "img", "agent:chat", "terminal:t1"], active: "a.ts" };
  const reads = [];
  registerTabReader({
    layout: () => layout,
    groups: () => [group],
    fileOf: (id) => files.get(id),
    terminalOf: (id) => (id === "terminal:t1" ? { id: "t1", status: "running" } : undefined),
    label: (id) => id,
    isDirty: (file) => file.draft !== undefined && file.draft !== file.content,
    readTerminal: async (id, lines) => (reads.push([id, lines]), { text: "0123456789", totalLines: 1, truncated: false }),
    register: (id, _title, run) => commands.set(id, run),
  });
  const list = commands.get("ide.workbench.tabs.list")();
  assert.deepEqual(list.tabs.map((tab) => [tab.kind, tab.dirty]), [["file", true], ["image", false], ["agent", false], ["terminal", undefined]]);
  const read = commands.get("ide.workbench.tab.read");
  assert.equal((await read()).text, "new");
  assert.equal((await read({ id: "img" })).text, undefined);
  assert.ok((await read({ id: "agent:chat" })).note);
  const tail = await read({ id: "terminal:t1", maxChars: 4, lines: 5 });
  assert.deepEqual([tail.text, tail.truncated, reads[0]], ["6789", true, ["t1", 5]]);
  await assert.rejects(read({ id: "missing" }), /не найдена/);
});
