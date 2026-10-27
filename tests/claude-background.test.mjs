import { afterEach, expect, test, vi } from "vite-plus/test";
import { createClaudeEventMapper } from "../server/modules/agents/claude-code/claude-code-events.ts";
import { createInput } from "../server/modules/agents/claude-code/claude-code-input.ts";
import { loadHistory } from "../src/modules/agent/model/load-history.ts";

const system = (subtype, extra) => ({
  type: "system",
  subtype,
  uuid: "u",
  session_id: "s",
  ...extra,
});
const result = { type: "result", subtype: "success", is_error: false, result: "готово" };
const first = { type: "user", message: { role: "user", content: [] } };

afterEach(() => vi.useRealTimers());

function mapperWithEvents() {
  const events = [];
  const mapper = createClaudeEventMapper((type, data) => events.push([type, data]));
  return { events, mapper };
}

test("the answer waits while a background subagent works", () => {
  const { events, mapper } = mapperWithEvents();
  mapper.handle(
    system("task_started", {
      task_id: "a1",
      description: "Работа",
      task_type: "local_agent",
      is_backgrounded: true,
    }),
  );
  mapper.handle(
    system("background_tasks_changed", {
      tasks: [{ task_id: "a1", task_type: "local_agent", description: "Работа" }],
    }),
  );
  expect(mapper.working).toBe(1);
  mapper.handle(result);
  expect(events.some(([type]) => type === "done")).toBe(false);
  expect(events.at(-1)).toEqual(["status", { phase: "background" }]);

  mapper.handle(system("background_tasks_changed", { tasks: [] }));
  mapper.handle(
    system("task_notification", { task_id: "a1", status: "completed", summary: "Готово" }),
  );
  mapper.handle(result);
  expect(events.filter(([type]) => type === "done")).toHaveLength(1);
  expect(mapper.working).toBe(0);
});

test("a background shell command holds the answer, an ambient watcher does not", () => {
  const { events, mapper } = mapperWithEvents();
  mapper.handle(
    system("background_tasks_changed", {
      tasks: [
        { task_id: "b1", task_type: "local_bash", description: "dev" },
        { task_id: "w", task_type: "local_agent", description: "watch", ambient: true },
      ],
    }),
  );
  expect(mapper.working).toBe(1);
  mapper.handle(result);
  expect(events.some(([type]) => type === "done")).toBe(false);
  expect(events.at(-1)).toEqual(["status", { phase: "background" }]);

  mapper.handle(system("background_tasks_changed", { tasks: [] }));
  mapper.handle(result);
  expect(events.at(-1)[0]).toBe("done");
});

test("an ambient watcher alone does not hold the answer", () => {
  const { events, mapper } = mapperWithEvents();
  mapper.handle(
    system("background_tasks_changed", {
      tasks: [{ task_id: "w", task_type: "local_agent", description: "watch", ambient: true }],
    }),
  );
  expect(mapper.working).toBe(0);
  mapper.handle(result);
  expect(events.at(-1)[0]).toBe("done");
});

test("what never reported is stopped and the held answer is delivered when the process ends", () => {
  const { events, mapper } = mapperWithEvents();
  mapper.handle(
    system("task_started", {
      task_id: "b1",
      description: "dev",
      task_type: "local_bash",
      is_backgrounded: true,
    }),
  );
  mapper.handle(
    system("task_started", {
      task_id: "a1",
      description: "Работа",
      task_type: "local_agent",
      is_backgrounded: true,
    }),
  );
  mapper.handle(
    system("background_tasks_changed", {
      tasks: [{ task_id: "a1", task_type: "local_agent", description: "Работа" }],
    }),
  );
  mapper.handle(result);
  mapper.finish();
  const stopped = events
    .filter(([type, data]) => type === "task" && data.status === "stopped")
    .map(([, data]) => data.id);
  expect(stopped.sort()).toEqual(["a1", "b1"]);
  expect(events.at(-1)[0]).toBe("done");
  mapper.finish();
  expect(events.filter(([type]) => type === "done")).toHaveLength(1);
});

test("a finished task is not stopped again", () => {
  const { events, mapper } = mapperWithEvents();
  mapper.handle(
    system("task_started", { task_id: "a1", description: "x", task_type: "local_agent" }),
  );
  mapper.handle(system("task_notification", { task_id: "a1", status: "completed", summary: "ok" }));
  mapper.finish();
  expect(events.filter(([, data]) => data.status === "stopped")).toHaveLength(0);
});

test("the input stays open for background agents and closes after they report", async () => {
  vi.useFakeTimers();
  const input = createInput(first);
  let done = false;
  void (async () => {
    for await (const _ of input.stream) void _;
    done = true;
  })();
  await vi.advanceTimersByTimeAsync(0);
  input.hold(true);
  input.settled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(done).toBe(false);

  // The report starts a following answer: the input waits for its result too.
  input.hold(false);
  input.busy();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(done).toBe(false);
  input.settled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(done).toBe(true);
});

test("a held input is closed after the longest wait", async () => {
  vi.useFakeTimers();
  const input = createInput(first);
  let done = false;
  void (async () => {
    for await (const _ of input.stream) void _;
    done = true;
  })();
  await vi.advanceTimersByTimeAsync(0);
  input.hold(true);
  input.settled();
  await vi.advanceTimersByTimeAsync(31 * 60_000);
  expect(done).toBe(true);
});

test("a chat without a live process shows no task as running", async () => {
  const turns = [
    { id: "1", role: "user", text: "q", tools: [] },
    {
      id: "2",
      role: "assistant",
      text: "a",
      tools: [],
      tasks: [
        { id: "a1", kind: "agent", title: "x", status: "running", background: true },
        { id: "b1", kind: "shell", title: "y", status: "done", background: false },
      ],
    },
  ];
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ turns: structuredClone(turns) }),
  }));
  const state = { turns: [], loading: false, error: "" };
  await loadHistory("/h", state);
  expect(state.turns[1].tasks.map((task) => task.status)).toEqual(["stopped", "done"]);

  const live = structuredClone(turns);
  live[1].run = "run1";
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ turns: live }) }));
  await loadHistory("/h", state);
  expect(state.turns[1].tasks[0].status).toBe("running");
  vi.unstubAllGlobals();
});

test("the input follows the messages of the process", async () => {
  vi.useFakeTimers();
  const input = createInput(first);
  let done = false;
  void (async () => {
    for await (const _ of input.stream) void _;
    done = true;
  })();
  await vi.advanceTimersByTimeAsync(0);
  input.settled();
  input.follow(system("background_tasks_changed", { tasks: [] }), 1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(done).toBe(false);
  input.follow(system("task_notification", { task_id: "a1", status: "completed" }), 0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(done).toBe(false);
  input.settled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(done).toBe(true);
});
