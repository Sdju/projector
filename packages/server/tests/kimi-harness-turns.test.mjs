import { expect, test } from "vite-plus/test";
import {
  isHarnessOnly,
  lostBackgroundAgents,
  sanitizeHarnessTurns,
} from "../modules/agent/harness-turns.ts";
import { hydrateKimiHistoryTasks } from "../modules/agents/kimi/history-tasks.ts";
import { createAcpReplayCollector } from "../modules/agents/acp/acp-events.ts";
import { createKimiDialect } from "../modules/agents/kimi/dialect.ts";

const lostReminder = `<system-reminder>
The user exited the application after your last turn, so your background tasks from the previous session lost contact:
- agent-l6gnbtpv "Унифицировать project trust" (subagent) — resume it with Agent(resume="agent-0", prompt="Pick up where you left off.") to continue from its prior context.
- agent-0z9d8aiy "Убрать hardcode версии" (subagent) — resume it with Agent(resume="agent-2", prompt="Pick up where you left off.") to continue from its prior context.
Don't assume any of them completed; check current state (they may still be running), then re-run or resume only what you still need.
</system-reminder>`;

test("isHarnessOnly recognizes a lost-contact reminder and mixed user text", () => {
  expect(isHarnessOnly(lostReminder)).toBe(true);
  expect(isHarnessOnly(`запускай фикс${lostReminder}`)).toBe(false);
});

test("lostBackgroundAgents parses resume keys and titles", () => {
  expect(lostBackgroundAgents(lostReminder)).toEqual([
    { taskId: "agent-l6gnbtpv", title: "Унифицировать project trust", resume: "agent-0" },
    { taskId: "agent-0z9d8aiy", title: "Убрать hardcode версии", resume: "agent-2" },
  ]);
});

test("sanitizeHarnessTurns drops harness-only user turns and stops matching tasks", () => {
  const turns = [
    {
      role: "assistant",
      text: "go",
      tasks: [
        {
          id: "t1",
          kind: "agent",
          title: "Унифицировать project trust",
          status: "running",
          background: true,
          session: "agent-0",
        },
        {
          id: "t2",
          kind: "agent",
          title: "Убрать hardcode версии",
          status: "running",
          background: true,
          session: "agent-2",
        },
      ],
    },
    { role: "user", text: lostReminder },
    { role: "user", text: `запускай по сабагенту${lostReminder}` },
  ];
  expect(sanitizeHarnessTurns(turns, 1_700_000_000_000)).toBe(true);
  expect(turns).toHaveLength(2);
  expect(turns[0].tasks.map((task) => task.status)).toEqual(["stopped", "stopped"]);
  expect(turns[0].tasks[0].summary).toMatch(/потеряла связь/);
  expect(turns[1]).toMatchObject({ role: "user", text: "запускай по сабагенту" });
});

test("sanitizeHarnessTurns marks lost tasks when reminder is glued to a real user line", () => {
  const turns = [
    {
      role: "assistant",
      text: "go",
      tasks: [
        {
          id: "t1",
          kind: "agent",
          title: "Унифицировать project trust",
          status: "running",
          background: true,
          session: "agent-0",
        },
      ],
    },
    { role: "user", text: `${lostReminder}\nкакой статус` },
  ];
  expect(sanitizeHarnessTurns(turns, 1)).toBe(true);
  expect(turns).toEqual([
    expect.objectContaining({
      tasks: [expect.objectContaining({ id: "t1", status: "stopped" })],
    }),
    { role: "user", text: "какой статус" },
  ]);
});

test("hydrateKimiHistoryTasks rebuilds Agent receipts into tasks", () => {
  const turns = [
    {
      role: "assistant",
      text: "spawned",
      tools: [
        {
          id: "tool_1",
          name: "Agent",
          status: "done",
          detail:
            "task_id: agent-l6gnbtpv\nstatus: running\nagent_id: agent-0\nactual_subagent_type: coder\n\ndescription: Унифицировать project trust\n",
        },
      ],
      tasks: [],
    },
  ];
  expect(hydrateKimiHistoryTasks(turns)).toBe(true);
  expect(turns[0].tasks).toEqual([
    {
      id: "tool_1",
      kind: "agent",
      title: "Унифицировать project trust",
      status: "running",
      background: true,
      hold: false,
      session: "agent-0",
      subagent: "coder",
      tool: "tool_1",
    },
  ]);
  expect(hydrateKimiHistoryTasks(turns)).toBe(false);
});

test("hydrateKimiHistoryTasks rebuilds detached Bash receipts into shell tasks", () => {
  const turns = [
    {
      role: "assistant",
      text: "run",
      tools: [
        {
          id: "tool_bash",
          name: "Bash",
          status: "done",
          detail:
            "task_id: bash-x\npid: 123\ndescription: Bash: vp run check\nstatus: running\nautomatic_notification: true\n",
        },
      ],
      tasks: [],
    },
  ];
  expect(hydrateKimiHistoryTasks(turns)).toBe(true);
  expect(turns[0].tasks).toEqual([
    {
      id: "tool_bash",
      kind: "shell",
      title: "vp run check",
      status: "running",
      background: true,
      hold: false,
      tool: "tool_bash",
    },
  ]);
  expect(hydrateKimiHistoryTasks(turns)).toBe(false);
});

test("kimi replay builds tasks and hides lost-contact harness turns", () => {
  const collector = createAcpReplayCollector("kimi", "s", createKimiDialect());
  collector.handleUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "spawned" },
  });
  collector.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "a1",
    title: "Agent",
    kind: "other",
    status: "in_progress",
    rawInput: {
      description: "Унифицировать project trust",
      subagent_type: "coder",
      run_in_background: true,
      prompt: "do it",
    },
  });
  collector.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "a1",
    status: "completed",
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "status: running\nagent_id: agent-0\nactual_subagent_type: coder\n\ndescription: Унифицировать project trust\n",
        },
      },
    ],
  });
  collector.handleUpdate({
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: lostReminder },
  });
  const turns = collector.turns;
  expect(turns.some((turn) => turn.role === "user")).toBe(false);
  expect(turns[0].tasks).toContainEqual(
    expect.objectContaining({
      id: "a1",
      title: "Унифицировать project trust",
      status: "stopped",
      session: "agent-0",
    }),
  );
});
