import { expect, test } from "vite-plus/test";
import { chatTabCommand } from "../src/modules/agent/lib/chat-tab.ts";

test("a chat key names the tab command and chat of an external agent", () => {
  expect(chatTabCommand("p1", "claude-code:p1:abc-1")).toEqual({
    command: "ide.workbench.claude.open",
    args: { chatId: "abc-1" },
  });
  expect(chatTabCommand("p1", "projector:p1:xyz")).toEqual({
    command: "ide.workbench.agent.open",
    args: { chatId: "xyz" },
  });
});

test("the project's own conversation and foreign keys have no tab to show", () => {
  expect(chatTabCommand("p1", "p1")).toBeUndefined();
  expect(chatTabCommand("p1", "claude-code:p2:abc")).toBeUndefined();
  expect(chatTabCommand("p1", "claude-code:p1:")).toBeUndefined();
});
