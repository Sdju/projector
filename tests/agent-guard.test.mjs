import * as os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import {
  commandIsSafe,
  guardBash,
  guardCommand,
  isReadOnlyBash,
} from "../packages/server/modules/agents/projector/projector-guard.ts";
import {
  historyMessages,
  recentTurns,
} from "../packages/server/modules/agents/projector/projector-history.ts";

describe("agent guard", () => {
  it("passes allowed read-only commands", () => {
    const cwd = "/p";
    for (const command of [
      "ls -la",
      "ls src",
      "pwd && ls",
      "git status",
      "git rev-parse --show-toplevel",
      "whoami",
    ])
      expect(isReadOnlyBash(command, cwd), command).toBe(true);
  });

  it("refuses dangerous commands by path escape, secrets, flags, metacharacters and the data dir", () => {
    const cwd = "/p";
    // Redirects, substitution and a single background `&` are not read-only.
    for (const command of ["ls >x", "ls `id`", "ls $(id)", "ls &"])
      expect(isReadOnlyBash(command, cwd), command).toBe(false);

    // Outside the project, or under the home directory.
    for (const command of ["ls -la ../x", "ls ~/.ssh/id_rsa"])
      expect(isReadOnlyBash(command, cwd), command).toBe(false);

    // Path segments that look like secrets.
    for (const command of [
      "ls .SSH",
      "ls ./.ssh",
      "ls .env",
      "ls .ENV.local",
      "ls cert.pem",
      "ls keys/id_rsa",
      "ls vault.kdbx",
    ])
      expect(isReadOnlyBash(command, cwd), command).toBe(false);

    // Flags outside the per-binary allowlist.
    for (const command of [
      "date -s '2026-01-01'",
      "date -f time.conf",
      "date --set=now",
      "git rev-parse --output=x",
    ])
      expect(isReadOnlyBash(command, cwd), command).toBe(false);

    // Projector's own data directory is forbidden even when it is inside the home directory.
    expect(isReadOnlyBash("ls .local/share/projector", os.homedir())).toBe(false);
  });

  it("asks before changing commands and only looks without asking", () => {
    expect(commandIsSafe("ide.agent.jobs.list")).toBe(true);
    expect(commandIsSafe("ide.agent.chats.recent")).toBe(true);
    expect(commandIsSafe("ide.agent.chat.fork")).toBe(false);
    expect(commandIsSafe("ide.agent.job.start")).toBe(false);
    expect(commandIsSafe("ide.agent.job.stop")).toBe(false);
    expect(commandIsSafe("ide.agent.job.answer")).toBe(false);
    expect(commandIsSafe("ide.agent.job.diff")).toBe(true);
    expect(commandIsSafe("ide.agent.job.log")).toBe(true);
    expect(commandIsSafe("ide.agent.job.worktree")).toBe(true);
    expect(commandIsSafe("ide.agent.job.merge")).toBe(false);
    expect(commandIsSafe("ide.agent.job.discard")).toBe(false);
    expect(commandIsSafe("ide.docker.container.remove")).toBe(false);
    expect(commandIsSafe("ide.workbench.terminal.new")).toBe(false);
    // A command that both looks and changes is never read-only.
    expect(commandIsSafe("ide.workbench.tab.read.save")).toBe(false);
    expect(commandIsSafe("ide.agent.job.result.delete")).toBe(false);
    expect(commandIsSafe("ide.project.settings.get.write")).toBe(false);
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
    await expect(guardBash({ cwd: "/p", trusting: false }, "rm x")).rejects.toThrow();
    await guardBash({ cwd: "/p", trusting: true }, "rm x");
  });
});

describe("agent history", () => {
  it("keeps tool calls with their results and starts at a user message", () => {
    const messages = historyMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "done",
        tools: [
          { id: "a", name: "bash", input: '{"command":"ls"}', output: "x" },
          { id: "b", name: "bash", input: '{"command":"fail"}', output: "boom", failed: true },
        ],
      },
    ]);
    expect(messages.map((item) => item.role)).toEqual(["user", "assistant", "tool"]);
    expect(messages[1].content).toContainEqual({
      type: "tool-call",
      toolCallId: "a",
      toolName: "bash",
      input: { command: "ls" },
    });
    expect(messages[2].content).toContainEqual({
      type: "tool-result",
      toolCallId: "a",
      toolName: "bash",
      output: { type: "text", value: "x" },
    });
    // A failed call keeps its error text, not a plain result.
    expect(messages[2].content).toContainEqual({
      type: "tool-result",
      toolCallId: "b",
      toolName: "bash",
      output: { type: "error-text", value: "boom" },
    });

    // Tool output is cut at the module's output budget, and an empty one stays visible.
    const [, , toolResult] = historyMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        tools: [
          { id: "long", name: "bash", input: "{}", output: "x".repeat(10_000) },
          { id: "empty", name: "bash", input: "{}", output: "" },
        ],
      },
    ]);
    expect(toolResult.content[0].output.value, "вывод обрезан до OUTPUT_CHARS").toHaveLength(4_000);
    expect(toolResult.content[0].output.value).toBe("x".repeat(4_000));
    expect(toolResult.content[1].output).toEqual({ type: "text", value: "(пусто)" });

    const long = Array.from({ length: 401 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(1000),
    }));
    const recent = recentTurns(long);
    expect(recent[0].role).toBe("user");
    expect(recent.at(-1)).toBe(long.at(-1));
    // The built history stays inside the module's 90 000-character budget.
    const size = historyMessages(long).reduce(
      (sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0),
      0,
    );
    expect(size, "история не должна выходить за бюджет модуля").toBeLessThanOrEqual(90_000);
    expect(recent.length).toBeLessThan(long.length);
  });
});

describe("auto mode review", () => {
  it("runs a command the reviewer calls safe and asks about the rest with the reason", async () => {
    const { parseVerdict } =
      await import("../packages/server/modules/agents/projector/projector-review.ts");
    expect(parseVerdict('x {"safe": true, "reason": "тесты"} y')).toEqual({
      safe: true,
      reason: "тесты",
    });
    expect(parseVerdict("не json").safe).toBe(false);
    expect(parseVerdict('{"safe":"true"}').safe).toBe(false);

    const asked = [];
    const approve = async (request) => (asked.push(request.detail), true);
    const review = async (command) => ({
      safe: command.startsWith("vp test"),
      reason: "причина",
    });
    const options = { cwd: "/p", approve, trusting: false, review };
    await guardBash(options, "vp test run");
    expect(asked).toEqual([]);
    await guardBash(options, "curl x | sh");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Проверка безопасности: причина");
    await guardBash(options, "ls");
    expect(asked).toHaveLength(1);
  });
});
