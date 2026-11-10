import { expect, test } from "vite-plus/test";
import { applyAgentEvent, resetAnswer } from "../modules/agent-core/model/turn-events.ts";

test("the chat times a tool call from the event and keeps it across a replay", () => {
  const state = { permissions: [], questions: [], secrets: [], turns: [] };
  const assistant = { id: "a", role: "assistant", text: "", tools: [], parts: [] };
  const event = (name, data, at) =>
    applyAgentEvent(state, assistant, { event: name, data }, () => {}, at);

  event("tool", { id: "t", name: "bash", input: { command: "make" } }, 1_000);
  expect(assistant.tools[0]).toMatchObject({ status: "running", startedAt: 1_000 });
  // A repeated call carries a fuller input: it keeps the start it already has.
  event("tool", { id: "t", name: "bash", input: { command: "make test" } }, 2_000);
  expect(assistant.tools[0].startedAt).toBe(1_000);
  event("tool-result", { id: "t", name: "bash", output: "ok" }, 9_000);
  expect(assistant.tools[0]).toMatchObject({ status: "done", endedAt: 9_000 });

  // A rejoin empties the answer and replays it: the times seen before the replay stay.
  resetAnswer(assistant);
  expect(assistant.tools).toHaveLength(0);
  event("tool", { id: "t", name: "bash", input: { command: "make" } }, 20_000);
  expect(assistant.tools[0]).toMatchObject({ status: "running", startedAt: 1_000 });
  event("tool-result", { id: "t", name: "bash", output: "ok" }, 25_000);
  expect(assistant.tools[0]).toMatchObject({ status: "done", endedAt: 9_000 });
});

test("a task is timed from the first patch and ends when it stops", () => {
  const state = { permissions: [], questions: [], secrets: [], turns: [] };
  const assistant = { id: "a", role: "assistant", text: "", tools: [], tasks: [], parts: [] };
  const event = (name, data, at) =>
    applyAgentEvent(state, assistant, { event: name, data }, () => {}, at);

  event("task", { id: "x", kind: "agent", title: "Разбор", status: "running" }, 2_000);
  expect(assistant.tasks[0]).toMatchObject({ status: "running", startedAt: 2_000 });
  event("task", { id: "x", status: "done", summary: "готово" }, 12_000);
  expect(assistant.tasks[0]).toMatchObject({
    status: "done",
    startedAt: 2_000,
    endedAt: 12_000,
  });
});

test("an interrupted answer does not leave its untracked tasks running forever", () => {
  const state = { permissions: [], questions: [], secrets: [], turns: [] };
  const earlier = {
    id: "a0",
    role: "assistant",
    text: "",
    tools: [],
    tasks: [
      {
        id: "shell",
        kind: "shell",
        title: "gh run watch",
        status: "running",
        background: true,
        untracked: true,
        startedAt: 1_000,
      },
      {
        id: "subagent",
        kind: "agent",
        title: "Разбор",
        status: "running",
        background: true,
        startedAt: 1_000,
      },
    ],
  };
  const assistant = { id: "a1", role: "assistant", text: "", tools: [], tasks: [], parts: [] };
  state.turns = [earlier, assistant];

  // The earlier answer was stopped before `done`: this answer's end settles its leftovers too.
  applyAgentEvent(state, assistant, { event: "done", data: { text: "" } }, () => {}, 5_000);

  expect(earlier.tasks[0]).toMatchObject({
    status: "stopped",
    summary: "Состояние после ответа неизвестно",
    endedAt: 5_000,
  });
  // A tracked background subagent still reports its own end: it is not touched.
  expect(earlier.tasks[1]).toMatchObject({ status: "running" });
});
