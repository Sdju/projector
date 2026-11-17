import { expect, test, vi } from "vite-plus/test";
import { settleAcpAnswer } from "../modules/agents/acp/acp-follow-up.ts";
import { createAcpEventMapper } from "../modules/agents/acp/acp-events.ts";
import { createPlainDialect } from "../modules/agents/acp/acp-dialect.ts";
import { watchOpenCodeFollowUp } from "../modules/agents/opencode/sessions.ts";

function answer(overrides = {}) {
  return {
    finish: vi.fn(),
    waitBackground: vi.fn(async () => {}),
    pollBackground: vi.fn(() => 0),
    text: "Начальный ответ.",
    pendingBackground: 0,
    keepsProcess: false,
    hadBackground: false,
    ...overrides,
  };
}
const program = { label: "OpenCode" };
function setup(subject, wait, options = {}) {
  const events = [];
  const result = settleAcpAnswer({
    answer: subject,
    program,
    followUp: { acceptsUpdates: () => true, wait },
    options: { emit: (event, data) => events.push([event, data]), ...options },
  });
  return { result, events };
}

test("continuation keeps the run open and emits one done with the full answer", async () => {
  const subject = answer({ hadBackground: true });
  let finish;
  const wait = vi.fn(async (options) => {
    options.onStart();
    await new Promise((resolve) => {
      finish = resolve;
    });
    subject.text += " Продолжение.";
    return { status: "completed" };
  });
  const { result, events } = setup(subject, wait);
  expect(events.map(([event]) => event)).toEqual(["status"]);
  finish();
  expect(await result).toBe(true);
  expect(events.filter(([event]) => event === "done")).toEqual([
    ["done", { text: "Начальный ответ. Продолжение.", added: [] }],
  ]);
});

test("without hard background work the answer closes as before", async () => {
  const wait = vi.fn();
  const { result, events } = setup(answer(), wait);
  expect(await result).toBe(false);
  expect(wait).not.toHaveBeenCalled();
  expect(events.map(([event]) => event)).toEqual(["done"]);
});

test.each(["timeout", "unavailable", "failed"])(
  "%s is reported as error, never done",
  async (status) => {
    const { result, events } = setup(answer({ hadBackground: true }), async () => ({
      status,
      error: "observer error",
    }));
    expect(await result).toBe(true);
    expect(events).toEqual([["error", { error: "observer error" }]]);
  },
);

test("aborted observation emits no success", async () => {
  const { result, events } = setup(answer({ hadBackground: true }), async () => ({
    status: "aborted",
  }));
  expect(await result).toBe(true);
  expect(events).toEqual([]);
});

test("a missing keep-alive marker is visible, never silent success", async () => {
  const wait = vi.fn();
  const { result, events } = setup(answer({ hadBackground: true }), wait, {
    run: { id: "bad run" },
  });
  expect(await result).toBe(true);
  expect(wait).not.toHaveBeenCalled();
  expect(events.map(([event]) => event)).toEqual(["error"]);
});

test("a second background child is polled and holds the same answer until its report", async () => {
  vi.useFakeTimers();
  try {
    const events = [];
    const emit = (event, data) => events.push([event, data]);
    let patches = [];
    const dialect = {
      ...createPlainDialect(),
      call: () => [{ id: "first", status: "running", background: true }],
      poll: () => patches.splice(0),
    };
    const mapper = createAcpEventMapper(emit, "OpenCode", dialect);
    mapper.handleUpdate("main", {
      sessionUpdate: "tool_call",
      toolCallId: "first",
      title: "subagent",
      status: "in_progress",
    });
    expect(mapper.pendingBackground).toBe(1);
    let state = { last: "idle", seq: 3, idle: 3, user: 1, firstUser: 1, interrupted: false };
    const result = settleAcpAnswer({
      answer: mapper,
      program,
      followUp: {
        acceptsUpdates: () => true,
        wait: (options) =>
          watchOpenCodeFollowUp("main", {
            ...options,
            baseline: { ...state, seq: 0, idle: 0 },
            read: () => state,
            intervalMs: 10,
            quietMs: 20,
            startMs: 30,
            totalMs: 1000,
          }),
      },
      options: { emit },
    });
    patches = [{ id: "first", status: "done" }];
    state = { ...state, last: "assistant", seq: 5 };
    await vi.advanceTimersByTimeAsync(10);
    patches = [{ id: "second", status: "running", background: true }];
    state = { ...state, last: "idle", seq: 6, idle: 6 };
    await vi.advanceTimersByTimeAsync(100);
    expect(mapper.pendingBackground).toBe(1);
    expect(events.some(([event]) => event === "done")).toBe(false);
    patches = [{ id: "second", status: "done" }];
    state = { ...state, last: "assistant", seq: 8 };
    await vi.advanceTimersByTimeAsync(10);
    mapper.handleUpdate("main", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Оба отчёта получены." },
    });
    state = { ...state, last: "idle", seq: 9, idle: 9 };
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(mapper.pendingBackground).toBe(0);
    expect(events.filter(([event]) => event === "done")).toEqual([
      ["done", { text: "Оба отчёта получены.", added: [] }],
    ]);
  } finally {
    vi.useRealTimers();
  }
});
