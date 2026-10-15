import { expect, test } from "vite-plus/test";
import {
  activatePanel,
  addPanel,
  createDockLayout,
  groupOfPanel,
  movePanel,
  reconcileDock,
} from "../src/modules/dock/index.ts";

const open = (ids) => ids.reduce((layout, id) => addPanel(layout, id, {}), createDockLayout());
const close = (layout, id) =>
  reconcileDock(layout, {
    ids: [],
    exists: (panel) => panel !== id,
  });
const active = (layout) => groupOfPanel(layout, "1")?.active;

test("closing the active tab returns to the one used before it, not a neighbour", () => {
  let layout = open(["1", "2", "3", "4"]);
  layout = activatePanel(layout, "2");
  layout = activatePanel(layout, "4");
  layout = close(layout, "4");
  expect(active(layout)).toBe("2");
});

test("history walks back through several tabs and skips closed ones", () => {
  let layout = open(["1", "2", "3", "4"]);
  for (const id of ["2", "4", "3"]) layout = activatePanel(layout, id);
  layout = close(layout, "4");
  layout = close(layout, "3");
  expect(active(layout)).toBe("2");
  layout = close(layout, "2");
  expect(active(layout)).toBe("1");
});

test("a tab moved to another group does not stay in the history of the old one", () => {
  let layout = open(["1", "2", "3"]);
  layout = activatePanel(layout, "2");
  layout = activatePanel(layout, "3");
  layout = movePanel(layout, "2", { zone: "right" });
  layout = close(layout, "3");
  expect(groupOfPanel(layout, "1")?.active).toBe("1");
});
