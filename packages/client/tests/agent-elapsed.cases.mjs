import { expect, test, vi } from "vite-plus/test";
import { AgentRunGone } from "../modules/agent-core/api/client.ts";
import { streamAnswer } from "../modules/agent-core/model/run-turn.ts";
import {
  answerLooksOpen,
  applyAgentEvent,
  resetAnswer,
  restoreAnswer,
  snapshotAnswer,
} from "../modules/agent-core/model/turn-events.ts";

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

  event(
    "task",
    { id: "x", kind: "agent", title: "Разбор", status: "running", model: "test-model" },
    2_000,
  );
  expect(assistant.tasks[0]).toMatchObject({
    status: "running",
    model: "test-model",
    startedAt: 2_000,
  });
  event("task", { id: "x", status: "done", summary: "готово" }, 12_000);
  expect(assistant.tasks[0]).toMatchObject({
    status: "done",
    model: "test-model",
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

test("done keeps the run while a hard-held background task still needs the stream", () => {
  const state = { permissions: [], questions: [], secrets: [], turns: [] };
  const assistant = {
    id: "a",
    role: "assistant",
    text: "",
    tools: [],
    tasks: [],
    parts: [],
    run: "run-1",
  };
  const event = (name, data, at) =>
    applyAgentEvent(state, assistant, { event: name, data }, () => {}, at);

  event(
    "task",
    {
      id: "sub",
      kind: "agent",
      title: "Fix",
      status: "running",
      background: true,
    },
    1_000,
  );
  event("done", { text: "ok" }, 2_000);
  expect(assistant.run).toBe("run-1");
  event("permission-request", { id: "p1", tool: "bash", title: "run", input: {} }, 2_500);
  expect(state.permissions).toHaveLength(1);
  event("task", { id: "sub", status: "done", background: true }, 3_000);
  expect(assistant.run).toBeUndefined();
});

test("soft keep-alive background (hold: false) clears run on done", () => {
  const state = { turns: [], permissions: [], questions: [], secrets: [], error: "", phase: "" };
  const assistant = {
    id: "a",
    role: "assistant",
    text: "",
    tools: [],
    tasks: [],
    parts: [],
    run: "run-soft",
  };
  const event = (name, data, at) =>
    applyAgentEvent(state, assistant, { event: name, data }, () => {}, at);

  event(
    "task",
    {
      id: "sub",
      kind: "agent",
      title: "Fix",
      status: "running",
      background: true,
      hold: false,
    },
    1_000,
  );
  event("done", { text: "ok" }, 2_000);
  expect(assistant.run).toBeUndefined();
});

test("a failed rejoin can put the previous answer back instead of saving an empty turn", () => {
  const assistant = {
    id: "a",
    role: "assistant",
    text: "Вливаю ветку",
    tools: [{ id: "t1", name: "shell", status: "done", detail: "ok" }],
    parts: [{ type: "text", text: "Вливаю ветку" }],
    tasks: [{ id: "x", kind: "agent", title: "gate", status: "running", background: true }],
  };
  const snapshot = snapshotAnswer(assistant);
  resetAnswer(assistant);
  expect(assistant.text).toBe("");
  expect(assistant.tools).toHaveLength(0);
  restoreAnswer(assistant, snapshot);
  expect(assistant).toMatchObject({
    text: "Вливаю ветку",
    tools: [{ id: "t1", name: "shell", status: "done" }],
    tasks: [{ id: "x", title: "gate", status: "running" }],
  });
  expect(assistant.parts).toEqual([{ type: "text", text: "Вливаю ветку" }]);
});

test("an emptied answer still looks open so a reload can rejoin the live host", () => {
  expect(
    answerLooksOpen({
      id: "a",
      role: "assistant",
      text: "",
      tools: [
        { id: "t1", name: "shell", status: "done", detail: "ok" },
        { id: "t2", name: "read", status: "done", detail: "ok" },
      ],
    }),
  ).toBe(true);
  expect(
    answerLooksOpen({
      id: "a",
      role: "assistant",
      text: "Готово",
      tools: [{ id: "t1", name: "shell", status: "running", detail: "git merge" }],
    }),
  ).toBe(true);
  expect(
    answerLooksOpen({
      id: "a",
      role: "assistant",
      text: "Готово",
      tools: [{ id: "t1", name: "shell", status: "done", detail: "ok" }],
      tasks: [{ id: "bg", kind: "agent", title: "Fix", status: "running", background: true }],
    }),
  ).toBe(false);
  expect(
    answerLooksOpen({
      id: "a",
      role: "assistant",
      text: "",
      tools: [],
      failure: "overloaded",
    }),
  ).toBe(false);
});

test("an attach that dies before events puts the previous answer back", async () => {
  const assistant = {
    id: "a",
    role: "assistant",
    text: "Вливаю ветку",
    tools: [{ id: "t1", name: "shell", status: "done", detail: "ok" }],
    parts: [{ type: "text", text: "Вливаю ветку" }],
    run: "run-1",
  };
  await expect(
    streamAnswer(
      assistant,
      async () => {
        throw new AgentRunGone("gone");
      },
      () => {},
      new AbortController().signal,
      "run-1",
    ),
  ).rejects.toBeInstanceOf(AgentRunGone);
  expect(assistant.text).toBe("Вливаю ветку");
  expect(assistant.tools).toEqual([{ id: "t1", name: "shell", status: "done", detail: "ok" }]);
});

test("a completed child before final done keeps the run available for reconnect", async () => {
  vi.useFakeTimers();
  try {
    const assistant = {
      id: "a",
      role: "assistant",
      text: "",
      tools: [],
      tasks: [],
      parts: [],
      run: "run-1",
    };
    const state = { permissions: [], questions: [], secrets: [], turns: [assistant] };
    const onEvent = (event) => applyAgentEvent(state, assistant, event, () => {});
    let calls = 0;
    const result = streamAnswer(
      assistant,
      async (emit, _signal, attach) => {
        calls++;
        if (calls === 2) expect(attach).toBe("run-1");
        emit({ event: "run", data: { id: "run-1" } });
        emit({ event: "text", data: { text: "Первый ответ." } });
        emit({ event: "task", data: { id: "child", status: "running", background: true } });
        emit({ event: "task", data: { id: "child", status: "done" } });
        emit({ event: "status", data: { phase: "thinking" } });
        expect(assistant.run).toBe("run-1");
        if (calls === 1) throw new Error("connection lost during continuation");
        emit({ event: "text", data: { text: " Продолжение." } });
        emit({ event: "done", data: { text: "Первый ответ. Продолжение.", added: [] } });
      },
      onEvent,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1100);
    await result;
    expect(calls).toBe(2);
    expect(assistant.text).toBe("Первый ответ. Продолжение.");
    expect(assistant.run).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("rejoining a previously failed turn clears its stale failure when replay succeeds", async () => {
  const assistant = {
    id: "a",
    role: "assistant",
    text: "",
    tools: [],
    parts: [],
    failure: "Hub connection failed",
    run: "run-1",
  };
  const state = { permissions: [], questions: [], secrets: [], turns: [assistant] };
  const onEvent = (event) => applyAgentEvent(state, assistant, event, () => {});
  await streamAnswer(
    assistant,
    async (emit) => {
      emit({ event: "text", data: { text: "Восстановленный ответ." } });
      emit({ event: "done", data: { text: "Восстановленный ответ.", added: [] } });
    },
    onEvent,
    new AbortController().signal,
    "run-1",
  );
  expect(assistant.text).toBe("Восстановленный ответ.");
  expect(assistant.failure).toBeUndefined();
});
