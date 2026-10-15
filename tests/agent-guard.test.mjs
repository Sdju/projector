import { describe, expect, it } from "vitest";
import {
  commandIsSafe,
  guardBash,
  guardCommand,
  isReadOnlyBash,
} from "../server/modules/agent/projector-guard.ts";
import { historyMessages, recentTurns } from "../server/modules/agent/projector-history.ts";

describe("agent guard", () => {
  it("lets read-only shell commands through and flags the rest", () => {
    for (const command of ["ls -la", "git status", "cat package.json | head -20", "pwd && ls"])
      expect(isReadOnlyBash(command), command).toBe(true);
    for (const command of [
      "rm -rf x",
      "echo a > b",
      "ls; rm x",
      "cat $(whoami)",
      "git push",
      "find . -delete",
      "sleep 1 &",
    ])
      expect(isReadOnlyBash(command), command).toBe(false);
  });

  it("asks before changing commands and only looks without asking", () => {
    expect(commandIsSafe("ide.workbench.tab.read")).toBe(true);
    expect(commandIsSafe("ide.project.settings.get")).toBe(true);
    expect(commandIsSafe("ide.docker.container.remove")).toBe(false);
    expect(commandIsSafe("ide.workbench.terminal.new")).toBe(false);
  });

  it("denies when the user refuses and remembers an always", async () => {
    const calls = [];
    const approve = async (request) => {
      calls.push(request.tool);
      return "always";
    };
    const options = { cwd: "/p", approve, trusting: false };
    await guardBash(options, "ls");
    expect(calls).toEqual([]);
    await guardBash(options, "rm x");
    await guardCommand(options, {
      command: "ide.project.settings.save",
      scope: "project:settings",
    });
    await guardCommand(options, {
      command: "ide.project.settings.save",
      scope: "project:settings",
    });
    expect(calls).toEqual(["bash", "execute_command"]);
    await expect(guardBash({ ...options, approve: async () => false }, "rm x")).rejects.toThrow();
    await expect(guardBash({ trusting: false }, "rm x")).rejects.toThrow();
    await guardBash({ trusting: true }, "rm x");
  });
});

describe("agent history", () => {
  it("keeps tool calls with their results and starts at a user message", () => {
    const messages = historyMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "done",
        tools: [{ id: "a", name: "bash", input: '{"command":"ls"}', output: "x" }],
      },
    ]);
    expect(messages.map((item) => item.role)).toEqual(["user", "assistant", "tool"]);
    const long = Array.from({ length: 400 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(1000),
    }));
    expect(recentTurns(long)[0].role).toBe("user");
    expect(recentTurns(long).length).toBeLessThan(long.length);
  });
});
