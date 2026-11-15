import { expect, test } from "vite-plus/test";
import {
  createLocalWorkspaceProfile,
  createSidebarRegistry,
  createTabRegistry,
  inboxTab,
  workspaceUtility,
} from "../modules/workspace-api/index.ts";
import { workspaceSessionSchema } from "../modules/workspace/session.ts";

test("service sections are marked as the utility group and the trash needs write access", () => {
  expect(workspaceUtility.map((type) => type.id)).toEqual(["hub", "trash"]);
  expect(workspaceUtility.every((type) => type.utility)).toBe(true);
  const writable = createSidebarRegistry(() => true, workspaceUtility);
  expect(writable.list().map((type) => type.id)).toEqual(["hub", "trash"]);
  const readonly = createSidebarRegistry((capability) => capability !== "write", workspaceUtility);
  expect(readonly.list().map((type) => type.id)).toEqual(["hub"]);
});

test("the work inbox is a singleton tab with its own command, not a right-rail section", () => {
  expect(workspaceUtility.some((type) => type.id === "inbox")).toBe(false);
  const tabs = createTabRegistry([inboxTab]);
  const type = tabs.get("inbox");
  expect(type?.command?.id).toBe("ide.workbench.inbox.open");
  expect(tabs.keyOf("inbox")).toBe("inbox:works");
});

test("the local profile offers the inbox tab and the utility sections", () => {
  const profile = createLocalWorkspaceProfile("project");
  expect(profile.utility).toBe(workspaceUtility);
  expect(profile.tabs?.some((tab) => tab.id === "inbox")).toBe(true);
  expect("aside" in profile).toBe(false);
});

test("the session remembers the last launched program", () => {
  const base = { tabs: [], activeKey: "", section: "files" };
  expect(workspaceSessionSchema.parse({ ...base, launcher: "claude" }).launcher).toBe("claude");
  expect(workspaceSessionSchema.safeParse({ ...base, launcher: 1 }).success).toBe(false);
  expect(workspaceSessionSchema.safeParse(base).success).toBe(true);
});
