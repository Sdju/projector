import { expect, test } from "vite-plus/test";
import { createClaudeEventMapper } from "../server/modules/agents/claude-code/claude-code-events.ts";
import { applyAgentEvent } from "../src/modules/agent/model/turn-events.ts";

const system = (subtype, extra) => ({
  type: "system",
  subtype,
  uuid: "u",
  session_id: "s",
  ...extra,
});

test("subagent and background command messages become task events", () => {
  const events = [];
  const mapper = createClaudeEventMapper((type, data) => events.push([type, data]));
  mapper.handle(
    system("task_started", {
      task_id: "a1",
      tool_use_id: "tu",
      description: "Найти вызовы",
      subagent_type: "Explore",
      task_type: "local_agent",
    }),
  );
  mapper.handle(
    system("task_started", {
      task_id: "b1",
      description: "npm run dev",
      task_type: "local_bash",
      is_backgrounded: true,
    }),
  );
  mapper.handle(system("task_started", { task_id: "x", description: "watch", ambient: true }));
  mapper.handle(
    system("task_progress", {
      task_id: "a1",
      description: "Найти вызовы",
      usage: { total_tokens: 900, tool_uses: 3, duration_ms: 4000 },
      last_tool_name: "Grep",
    }),
  );
  mapper.handle(
    system("task_notification", { task_id: "a1", status: "completed", summary: "Готово" }),
  );
  expect(events.map(([, data]) => data.id)).toEqual(["a1", "b1", "a1", "a1"]);
  expect(events[0][1]).toMatchObject({
    kind: "agent",
    subagent: "Explore",
    tool: "tu",
    background: false,
  });
  expect(events[1][1]).toMatchObject({ kind: "shell", background: true });
  expect(events[3][1]).toEqual({ id: "a1", status: "done", summary: "Готово" });
});

test("task events are merged into one row of the answer", () => {
  const state = { permissions: [], questions: [] };
  const turn = { id: "t", role: "assistant", text: "", tools: [] };
  const apply = (data) => applyAgentEvent(state, turn, { event: "task", data }, () => {});
  apply({ id: "a1", kind: "agent", title: "Поиск", status: "running", background: true });
  apply({ id: "a1", tools: 2 });
  apply({ id: "a1", status: "done" });
  expect(turn.tasks).toEqual([
    { id: "a1", kind: "agent", title: "Поиск", status: "done", background: true, tools: 2 },
  ]);
});
