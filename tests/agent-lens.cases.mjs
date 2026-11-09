import { expect, test, vi } from "vite-plus/test";
import { effectScope, nextTick, ref } from "vue";

vi.mock("../packages/client/modules/agent-core/api/lens.ts", () => ({ fetchLens: vi.fn() }));

const { fetchLens } = await import("../packages/client/modules/agent-core/api/lens.ts");
const { LENS_THINKING_TEXT, lensHistory, lensState, lensStep, useAgentLens } =
  await import("../packages/client/modules/agent-turns/model/lens.ts");

function conversation() {
  return [
    { id: "u1", role: "user", text: "почини сборку", tools: [] },
    {
      id: "a1",
      role: "assistant",
      text: "запускаю сборку",
      tools: [
        {
          id: "t1",
          name: "Bash",
          status: "running",
          detail: "",
          input: '{"command":"vp build"}',
          startedAt: 1,
        },
        { id: "t2", name: "Read", status: "done", detail: "ok", input: '{"path":"src/main.ts"}' },
      ],
      parts: [
        { type: "text", text: "запускаю сборку" },
        { type: "thought", text: "Сначала проверю, почему падает сборка" },
        { type: "tool", id: "t2" },
      ],
    },
  ];
}

function options(overrides = {}) {
  return {
    turns: ref(conversation()),
    busy: ref(true),
    phase: ref("думает"),
    queue: ref([]),
    plan: ref([{ content: "Собрать проект", status: "in_progress" }]),
    selection: ref({ provider: "env:test" }),
    intervalMs: 1_000,
    ...overrides,
  };
}

test("Lens reads the visible chat including the answer still being written", () => {
  const history = lensHistory(conversation());
  expect(history[0]).toMatchObject({ role: "user", content: "почини сборку" });
  expect(JSON.stringify(history)).toContain("запускаю сборку");
  // Reasoning names the intent; finished calls travel with the history, the running one as state.
  expect(JSON.stringify(history)).toContain("Сначала проверю");
  expect(JSON.stringify(history)).toContain("Read");
  expect(JSON.stringify(history)).not.toContain("vp build");
});

test("Lens state reports running calls, the plan and the queue", () => {
  const state = lensState(
    conversation(),
    true,
    "думает",
    [{ id: "q1", text: "и ещё" }],
    [{ content: "Собрать проект", status: "in_progress" }],
  );
  expect(state).toMatchObject({
    busy: true,
    phase: "думает",
    queue: 1,
    plan: [{ content: "Собрать проект", status: "in_progress" }],
    running: [{ name: "Bash", input: '{"command":"vp build"}', startedAt: 1 }],
  });
});

test("Lens does not treat a change of call as a new step", () => {
  const answer = (id) => [
    {
      id: "a1",
      role: "assistant",
      text: "",
      tools: [{ id, name: "Bash", status: "running", detail: "" }],
      parts: [],
    },
  ];
  expect(lensStep(answer("t1"), "думает", [])).toBe(lensStep(answer("t2"), "думает", []));
});

test("Lens asks for a caption with the chat and the live state, and keeps it", async () => {
  fetchLens.mockReset();
  fetchLens.mockResolvedValue({ text: "Собирает проект после правки.", at: 1_000 });
  const lensOptions = options();
  const scope = effectScope();
  const lens = scope.run(() => useAgentLens(lensOptions));
  try {
    expect(lens.state.open).toBe(false);
    const text = await lens.open();
    expect(text).toBe("Собирает проект после правки.");
    expect(lens.state.open).toBe(true);
    expect(lens.state).toMatchObject({ busy: false, at: 1_000, error: "" });
    expect(fetchLens).toHaveBeenCalledTimes(1);
    const [input, signal] = fetchLens.mock.calls[0];
    expect(input.selection).toStrictEqual({ provider: "env:test" });
    expect(input.state).toMatchObject({ busy: true, phase: "думает", queue: 0 });
    expect(input.history[0].content).toBe("почини сборку");
    expect(signal).toBeInstanceOf(AbortSignal);
    await lens.refresh();
    expect(fetchLens).toHaveBeenCalledTimes(2);
    lens.close();
    expect(lens.state.open).toBe(false);
  } finally {
    scope.stop();
  }
});

test("Lens refreshes on its own only while the agent is busy", async () => {
  vi.useFakeTimers();
  fetchLens.mockReset();
  fetchLens.mockImplementation(async () => ({ text: "Собирает проект.", at: Date.now() }));
  const lensOptions = options();
  const scope = effectScope();
  const lens = scope.run(() => useAgentLens(lensOptions));
  try {
    await lens.open();
    expect(fetchLens).toHaveBeenCalledTimes(1);
    // The same steps: the timer must not ask for the same caption again.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchLens).toHaveBeenCalledTimes(1);
    // The plan moved on: this is a new step, so the timer asks again.
    lensOptions.plan.value = [
      { content: "Собрать проект", status: "completed" },
      { content: "Проверить тесты", status: "in_progress" },
    ];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchLens).toHaveBeenCalledTimes(2);
    lensOptions.busy.value = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchLens).toHaveBeenCalledTimes(2);
    lens.setAuto(false);
    lensOptions.busy.value = true;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchLens).toHaveBeenCalledTimes(2);
    expect(lens.state.auto).toBe(false);
  } finally {
    scope.stop();
    vi.useRealTimers();
  }
});

test("Lens shows the placeholder until reasoning arrives, then names the intent", async () => {
  vi.useFakeTimers();
  fetchLens.mockReset();
  fetchLens.mockResolvedValue({ text: "Проверяет падение сборки.", at: 2_000 });
  const turns = ref([
    { id: "u1", role: "user", text: "почини сборку", tools: [] },
    { id: "a1", role: "assistant", text: "", tools: [] },
  ]);
  const scope = effectScope();
  const lens = scope.run(() => useAgentLens(options({ turns, plan: ref([]), intervalMs: 60_000 })));
  try {
    const text = await lens.open();
    // A turn that has not reasoned or called anything yet gets no paid request.
    expect(text).toBe(LENS_THINKING_TEXT);
    expect(fetchLens).not.toHaveBeenCalled();
    turns.value[1].parts = [{ type: "thought", text: "Сначала проверю, почему падает сборка" }];
    await nextTick();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchLens).toHaveBeenCalledTimes(1);
    expect(lens.state.text).toBe("Проверяет падение сборки.");
    expect(fetchLens.mock.calls[0][0].history.at(-1).thoughts).toContain("проверю");
    // The thought goes on, but it is still the same step: no request per token.
    turns.value[1].parts[0].text += " и запущу тесты";
    await nextTick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchLens).toHaveBeenCalledTimes(1);
  } finally {
    scope.stop();
    vi.useRealTimers();
  }
});

test("Lens keeps the old caption when the request fails, and drops an aborted one", async () => {
  fetchLens.mockReset();
  fetchLens.mockRejectedValue(new Error("Провайдер не ответил"));
  const scope = effectScope();
  const lens = scope.run(() => useAgentLens(options()));
  try {
    await lens.open();
    expect(lens.state.error).toBe("Провайдер не ответил");
    expect(lens.state.text).toBe("");
  } finally {
    scope.stop();
  }

  let answer;
  fetchLens.mockReset();
  fetchLens.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
  const second = effectScope();
  const aborted = second.run(() => useAgentLens(options()));
  try {
    const pending = aborted.open();
    aborted.close();
    answer({ text: "устаревшая сводка", at: 5 });
    await pending;
    expect(aborted.state.open).toBe(false);
    expect(aborted.state.text).toBe("");
    expect(aborted.state.busy).toBe(false);
  } finally {
    second.stop();
  }
});
