import { expect, test, vi } from "vite-plus/test";

const transcript = vi.hoisted(() => []);
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: async () => transcript,
}));

// The setup already loaded the real SDK through the registered agents.
vi.resetModules();
const { claudeLoadSession } =
  await import("../server/modules/agents/claude-code/claude-code-sessions.ts");

const user = (content) => ({ type: "user", message: { content }, parent_tool_use_id: null });
const assistant = (content) => ({
  type: "assistant",
  message: { content },
  parent_tool_use_id: null,
});

test("a reopened Claude Code chat keeps the order and hides the traces of commands", async () => {
  transcript.length = 0;
  transcript.push(
    user("найди вызовы"),
    assistant([
      { type: "thinking", thinking: "надо поискать" },
      { type: "text", text: "Ищу." },
      { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "x" } },
      {
        type: "tool_use",
        id: "t2",
        name: "Task",
        input: { description: "Обзор", subagent_type: "Explore", prompt: "p" },
      },
      {
        type: "tool_use",
        id: "t3",
        name: "Bash",
        input: { command: "npm run dev", run_in_background: true },
      },
    ]),
    user([{ type: "tool_result", tool_use_id: "t1", content: "found" }]),
    user([{ type: "tool_result", tool_use_id: "t2", content: "ok" }]),
    assistant([{ type: "text", text: "Готово." }]),
    user(
      "<task-notification>\n<task-id>b9</task-id>\n<tool-use-id>t3</tool-use-id>\n<status>completed</status>\n<summary>dev stopped</summary>\n</task-notification>",
    ),
    user("<command-name>/compact</command-name>\n<command-message>compact</command-message>"),
    user("<local-command-stdout>Compacted </local-command-stdout>"),
    user("This session is being continued from a previous conversation that ran out of context."),
  );
  const turns = await claudeLoadSession("/tmp", "s1");

  // No turn made of command traces or reports; the compact summary is a note.
  expect(turns.map((turn) => turn.role)).toStrictEqual(["user", "assistant"]);
  const answer = turns[1];
  expect(answer.parts.map((part) => part.type)).toStrictEqual([
    "thought",
    "text",
    "tool",
    "tool",
    "tool",
    "text",
    "note",
  ]);
  expect(answer.text).toBe("Ищу.\n\nГотово.");
  expect(answer.tasks).toMatchObject([
    { id: "t2", kind: "agent", subagent: "Explore", status: "done" },
    { id: "t3", kind: "shell", background: true, status: "done", summary: "dev stopped" },
  ]);
});

test("a background task without a report is left in a known state", async () => {
  transcript.length = 0;
  transcript.push(
    user("запусти"),
    assistant([
      { type: "tool_use", id: "b", name: "Bash", input: { command: "x", run_in_background: true } },
    ]),
  );
  const [, answer] = await claudeLoadSession("/tmp", "s2");
  expect(answer.tasks[0]).toMatchObject({ status: "stopped" });
});
