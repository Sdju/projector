import { expect, test } from "vite-plus/test";
import { applyAgentEvent, resetAnswer } from "../src/modules/agent/model/turn-events.ts";
import { formatElapsed } from "../src/modules/agent/lib/elapsed.ts";

test("durations read as a short clock", () => {
  expect(formatElapsed(0)).toBe("0 с");
  expect(formatElapsed(4_400)).toBe("4 с");
  expect(formatElapsed(65_000)).toBe("1:05");
  expect(formatElapsed(3_725_000)).toBe("1:02:05");
  expect(formatElapsed(-500)).toBe("0 с");
});

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
