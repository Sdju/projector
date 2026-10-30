import { describe, expect, it } from "vite-plus/test";
import {
  commandIsSafe,
  guardBash,
  guardCommand,
  isReadOnlyBash,
} from "../server/modules/agents/projector/projector-guard.ts";
import {
  historyMessages,
  recentTurns,
} from "../server/modules/agents/projector/projector-history.ts";

describe("agent guard", () => {
  it("lets read-only shell commands through and flags the rest", () => {
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

    for (const command of [
      "rm -rf x",
      "echo a > b",
      "ls; rm x",
      "cat $(whoami)",
      "git push",
      "find . -delete",
      "sleep 1 &",
      "cat .env",
      "cat ~/.ssh/id_rsa",
      "grep -r KEY ~/.local/share/projector",
      "head -100 /proc/self/environ",
      "find / -name id_rsa",
      "rg --pre=./run.sh TOKEN .",
      "git show HEAD:.env",
      "cat /etc/passwd",
      "tree -o output.txt",
      "sort --compress-program=bzip2",
      "rg --pre echo TOKEN",
      "rg --pre-glob '*.c' pattern",
      "git diff --textconv HEAD",
      "date -s '2026-01-01'",
      "date -f /etc/time.conf",
      "file -C",
      "grep -f ~/.ssh/id_rsa",
      "cat package.json | head -20",
      "rg TOKEN src",
      "grep -rn guard server",
      "find . -name '*.md'",
      "git diff --no-textconv HEAD",
      "git remote -v",
      "ls -la ../x",
      "ls .SSH",
      "ls ./.ssh",
      "git rev-parse --output=x",
      "git remote add origin x",
      "date --set=now",
      "rg --pre=./x a",
      "rg --pre-glob=* a",
      "sort --compress-program=./x a",
      "tree -o=out.txt",
      "date --set=now",
      "git rev-parse --output=x",
      "git show HEAD:f.env",
      "git diff HEAD -- .env",
      "git log -p -- .env",
      "git show HEAD -- .env",
      "git blame .env",
      "git remote add origin x",
      "git remote set-url origin y",
      "git remote remove origin",
      "cat ./.ssh/config",
      "cat .ENV",
      "cat .Env.local",
    ])
      expect(isReadOnlyBash(command, cwd), command).toBe(false);
  });

  it("asks before changing commands and only looks without asking", () => {
    expect(commandIsSafe("ide.workbench.tab.read")).toBe(true);
    expect(commandIsSafe("ide.agent.jobs.list")).toBe(true);
    expect(commandIsSafe("ide.agent.chats.recent")).toBe(true);
    expect(commandIsSafe("ide.agent.chat.fork")).toBe(false);
    expect(commandIsSafe("ide.agent.job.result")).toBe(true);
    expect(commandIsSafe("ide.agent.job.open")).toBe(true);
    expect(commandIsSafe("ide.agent.job.start")).toBe(false);
    expect(commandIsSafe("ide.agent.job.stop")).toBe(false);
    expect(commandIsSafe("ide.agent.job.answer")).toBe(false);
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

describe("auto mode review", () => {
  it("runs a command the reviewer calls safe and asks about the rest with the reason", async () => {
    const { parseVerdict } = await import("../server/modules/agents/projector/projector-review.ts");
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
