import { expect, test, vi } from "vite-plus/test";
import {
  deriveTrajectoryTimeline,
  trajectoryFocusIds,
  trajectoryFromTurns,
  trajectoryPreview,
} from "../modules/agent-trajectory/index.ts";
import { trajectoryDocumentFrom } from "../modules/agent-trajectory/model/documents.ts";
import {
  latestTrajectoryDocument,
  putTrajectoryDocument,
  useTrajectoryDocument,
} from "../modules/agent-trajectory/model/store.ts";
import { registerTrajectoryCommands } from "../modules/agent-trajectory/model/commands.ts";
import { registerChat } from "../modules/agent-core/index.ts";
import {
  generateTrajectoryDocument,
  registerTrajectoryAdapter,
} from "../modules/agent-trajectory/model/generator.ts";
import {
  isTrajectoryFilePath,
  trajectoryFileTitle,
} from "../modules/agent-trajectory/model/file.ts";

const turn = (overrides) => ({
  id: "u1",
  role: "user",
  text: "Проверь сборку",
  at: 1_000,
  tools: [],
  ...overrides,
});

function chatTurns() {
  return [
    turn({ injected: "Инструкции проекта" }),
    {
      id: "a1",
      role: "assistant",
      text: "Сначала посмотрю.",
      at: 2_000,
      tools: [
        {
          id: "t1",
          name: "bash",
          status: "done",
          input: '{"command":"vp test"}',
          detail: "ok",
          startedAt: 2_500,
          endedAt: 3_500,
        },
        {
          id: "t2",
          name: "subagent",
          status: "done",
          input: '{"description":"Разбор"}',
          detail: "готово",
          parent: "t1",
          startedAt: 2_600,
          endedAt: 9_000,
        },
      ],
      parts: [
        { type: "thought", text: "Надо запустить тесты." },
        { type: "tool", id: "t1" },
        { type: "text", text: "Сначала посмотрю." },
        { type: "tool", id: "t2" },
      ],
      usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 1, cost: 0.01 },
      context: { used: 1_000, size: 8_000, model: "deepseek" },
      tasks: [
        {
          id: "x",
          kind: "agent",
          title: "Разбор",
          status: "done",
          background: false,
          startedAt: 2_600,
          endedAt: 9_000,
          summary: "готово",
          tool: "t2",
        },
      ],
    },
  ];
}

test("a chat projects context, the request, the answer, calls and tasks in order", () => {
  const data = trajectoryFromTurns(chatTurns());

  expect(data.turns).toHaveLength(1);
  expect(data.turns[0]).toMatchObject({
    number: 1,
    title: "Проверь сборку",
    startedAt: 1_000,
    status: "done",
  });
  expect(data.records.map((record) => [record.kind, record.title])).toEqual([
    ["context", "Инструкции Projector"],
    ["user", "Проверь сборку"],
    ["thought", "Размышление"],
    ["tool", "Команда"],
    ["assistant", "Ответ"],
    ["subtool", "Субагент"],
    ["task", "Разбор"],
  ]);
  expect(data.records.every((record) => record.turn === 1)).toBe(true);
  expect(data.records[3]).toMatchObject({
    id: "tool:t1",
    callId: "t1",
    durationMs: 1_000,
    status: "done",
  });
  expect(data.records[5]).toMatchObject({
    id: "tool:t2",
    parentId: "t1",
    durationMs: 6_400,
  });
  expect(data.records[6]).toMatchObject({
    id: "task:x",
    parentId: "t2",
    durationMs: 6_400,
    text: "готово",
  });
  expect(data.counts).toMatchObject({
    turns: 1,
    records: 7,
    tools: 2,
    tasks: 1,
    errors: 0,
  });
  expect(data.usage).toEqual({
    input: 100,
    output: 20,
    cacheRead: 50,
    cacheWrite: 1,
    cost: 0.01,
  });
  expect(data.capabilities).toMatchObject({
    steps: false,
    ttft: false,
    tools: true,
    tasks: true,
    usage: true,
    costs: true,
    context: true,
  });
  expect(data.notice).toContain("Шаги модели");
});

test("a busy last answer is running; a failure becomes an error record", () => {
  const turns = chatTurns();
  turns[1].text = "";
  turns[1].parts = [];
  const running = trajectoryFromTurns(turns, { busy: true });
  expect(running.turns[0]?.status).toBe("running");
  expect(running.records.some((record) => record.status === "running")).toBe(true);
  expect(running.capabilities.live).toBe(true);

  const failed = trajectoryFromTurns([
    turn(),
    { id: "a2", role: "assistant", text: "", at: 2_000, tools: [], failure: "нет сети" },
  ]);
  expect(failed.turns[0]?.status).toBe("error");
  expect(failed.counts.errors).toBe(1);
  expect(failed.records.at(-1)).toMatchObject({ kind: "note", title: "Ошибка", status: "error" });
});

test("a stopped answer keeps its stopped status", () => {
  const data = trajectoryFromTurns([
    turn(),
    {
      id: "a2",
      role: "assistant",
      text: "Частичный ответ",
      at: 2_000,
      tools: [],
      stopped: "steps",
    },
  ]);

  expect(data.turns[0]?.status).toBe("stopped");
  expect(data.records.at(-1)?.status).toBe("stopped");
  expect(data.capabilities.live).toBe(false);
});

test("the current history has no step or TTFT claims", () => {
  const data = trajectoryFromTurns(chatTurns());
  expect(data.capabilities.steps).toBe(false);
  expect(data.capabilities.ttft).toBe(false);
  expect(data.records.every((record) => record.meta?.ttft === undefined)).toBe(true);
});

test("sequence and duration overview place records on three lanes", () => {
  const data = trajectoryFromTurns(chatTurns());
  const sequence = deriveTrajectoryTimeline(data, "sequence");
  expect(sequence).not.toBeNull();
  expect(sequence.spans).toHaveLength(data.records.length);
  expect(sequence.spans[1]).toMatchObject({ lane: 0 });
  expect(sequence.spans[4]).toMatchObject({ lane: 1 });
  expect(sequence.spans[3]).toMatchObject({ lane: 2, end: 4 });
  expect(sequence.boundaries).toEqual([{ turn: 1, time: 0 }]);

  const duration = deriveTrajectoryTimeline(data, "duration");
  expect(duration).not.toBeNull();
  expect(duration.hasDuration).toBe(true);
  const tool = duration.spans.find((span) => span.record.id === "tool:t1");
  expect((tool?.end ?? 0) - (tool?.start ?? 0)).toBe(1_000);
  expect(duration.start).toBe(1_000);
  expect(duration.end).toBeGreaterThan(duration.start);
});

test("a focus interval keeps every overlapping record", () => {
  const data = trajectoryFromTurns(chatTurns());
  const sequence = deriveTrajectoryTimeline(data, "sequence");
  const ids = trajectoryFocusIds(data, { start: 3.5, end: 3.5 }, "sequence");
  expect(ids).not.toBeNull();
  expect([...ids]).toEqual(["tool:t1"]);

  const duration = deriveTrajectoryTimeline(data, "duration");
  const nested = duration.spans.find((span) => span.record.id === "tool:t2");
  const timed = trajectoryFocusIds(data, { start: nested.start, end: nested.start }, "duration");
  expect(timed).not.toBeNull();
  expect(timed.has("tool:t1")).toBe(true);
  expect(timed.has("tool:t2")).toBe(true);
  expect(timed.has("task:x")).toBe(true);
  // The sequence model is the authority for the projection it was derived from.
  expect(sequence.spans[3]?.record.id).toBe("tool:t1");
});

test("an empty chat yields a valid empty model", () => {
  const data = trajectoryFromTurns([]);
  expect(data.records).toEqual([]);
  expect(data.turns).toEqual([]);
  expect(deriveTrajectoryTimeline(data, "sequence")).toBeNull();
  expect(deriveTrajectoryTimeline(data, "duration")).toBeNull();
});

test("a preview is one line and keeps its source intact", () => {
  expect(trajectoryPreview(" # Заголовок\n\n**жирный**   текст ")).toBe("Заголовок жирный текст");
  expect(trajectoryPreview("abc", 2)).toBe("a…");
});

const record = (id, kind, turn, extra = {}) => ({ id, kind, turn, title: id, ...extra });

test("a document file fills turns, counts and capabilities from records alone", () => {
  const document = trajectoryDocumentFrom({
    format: "projector.trajectory",
    version: 1,
    title: "Разбор падения",
    data: {
      records: [
        record("u", "user", 1, { text: "Почему упал тест?" }),
        record("a", "assistant", 1, { text: "Смотрю стек." }),
        record("t", "tool", 1, {
          title: "Команда",
          status: "error",
          durationMs: 1200,
        }),
      ],
    },
  });

  expect(document.title).toBe("Разбор падения");
  expect(document.data.turns).toHaveLength(1);
  expect(document.data.turns[0]).toMatchObject({
    number: 1,
    title: "Почему упал тест?",
    status: "error",
  });
  expect(document.data.records.map((item) => item.id)).toEqual(["u", "a", "t"]);
  expect(document.data.counts).toMatchObject({ records: 3, tools: 1, errors: 1 });
  expect(document.data.capabilities).toMatchObject({
    steps: false,
    ttft: false,
    tools: true,
    usage: false,
    live: false,
  });
});

test("a document accepts chat turns, a direct data object and a JSON string", () => {
  const chat = trajectoryDocumentFrom({
    title: "Чат",
    turns: [
      { id: "u", role: "user", text: "Проверь", at: 1_000, tools: [] },
      {
        id: "a",
        role: "assistant",
        text: "Готово",
        at: 2_000,
        tools: [],
        parts: [{ type: "text", text: "Готово" }],
      },
    ],
  });
  expect(chat.title).toBe("Чат");
  expect(chat.data.records.map((item) => item.kind)).toEqual(["user", "assistant"]);

  const direct = trajectoryDocumentFrom({
    records: [record("one", "note", 0)],
  });
  expect(direct.data.turns[0]?.number).toBe(0);
  expect(direct.data.records[0]?.kind).toBe("note");

  const json = trajectoryDocumentFrom(
    JSON.stringify({ records: [record("json", "assistant", 2, { text: "ok" })] }),
  );
  expect(json.data.records[0]?.id).toBe("json");
  expect(json.data.turns[0]?.number).toBe(2);
});

test("a malformed document names its problem", () => {
  expect(() => trajectoryDocumentFrom("{")).toThrow("Некорректный JSON");
  expect(() => trajectoryDocumentFrom({ format: "other" })).toThrow("Неизвестный формат");
  expect(() => trajectoryDocumentFrom({ format: "projector.trajectory", version: 2 })).toThrow(
    "Неподдерживаемая версия",
  );
  expect(() => trajectoryDocumentFrom({ records: [] })).toThrow("нет записей");
  expect(() => trajectoryDocumentFrom({ data: 42 })).toThrow("data должен быть объектом");

  const nested = trajectoryDocumentFrom({
    turns: [{ number: 4, records: [{ id: "nested", kind: "assistant", title: "Ответ" }] }],
  });
  expect(nested.data.records[0]?.turn).toBe(4);
  expect(nested.data.turns[0]?.records[0]?.id).toBe("nested");
});

test("generated document ids stay unique within one millisecond", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  try {
    const first = trajectoryDocumentFrom({ records: [record("a", "note", 1)] });
    const second = trajectoryDocumentFrom({ records: [record("b", "note", 1)] });
    expect(first.id).not.toBe(second.id);
  } finally {
    now.mockRestore();
  }
});

test("the store gives a tab and the panel the same document", () => {
  const document = putTrajectoryDocument({
    title: "Общая",
    records: [record("shared", "assistant", 1)],
  });
  expect(latestTrajectoryDocument().value?.id).toBe(document.id);
  expect(useTrajectoryDocument(document.id).value?.title).toBe("Общая");
  expect(useTrajectoryDocument(undefined).value?.id).toBe(document.id);
});

test("the agent commands open a tab or the right panel with the same payload", () => {
  const commands = new Map();
  const calls = [];
  let mobile = false;
  registerTrajectoryCommands({
    register: (id, title, run) => commands.set(id, { title, run }),
    projectId: "project",
    openTab: (id, params, options) => calls.push({ surface: "tab", id, params, options }),
    showPanel: (id) => calls.push({ surface: "panel", id }),
    mobile: () => mobile,
  });

  const opened = commands.get("ide.trajectory.open").run({
    title: "Из команды",
    data: {
      records: [record("cmd", "assistant", 1, { text: "Ответ" })],
    },
  });
  expect(opened.surface).toBe("tab");
  expect(calls[0]).toMatchObject({
    surface: "tab",
    id: "trajectory",
    params: { title: "Из команды" },
  });

  const panel = commands.get("ide.trajectory.panel").run({ id: opened.id });
  expect(panel.surface).toBe("panel");
  expect(calls[1]).toMatchObject({ surface: "panel", id: opened.id });

  mobile = true;
  const fallback = commands.get("ide.trajectory.panel").run({ id: opened.id });
  expect(fallback.surface).toBe("tab");
  expect(calls[2]).toMatchObject({ surface: "tab", id: "trajectory" });
});

test("only the special file names open the document viewer", () => {
  expect(isTrajectoryFilePath("incident.trajectory.json")).toBe(true);
  expect(isTrajectoryFilePath("incident.trace.json")).toBe(true);
  expect(isTrajectoryFilePath("incident.json")).toBe(false);
  expect(isTrajectoryFilePath("trajectory.json")).toBe(false);
  expect(trajectoryFileTitle("incident.trajectory.json")).toBe("incident");
});

test("a registered adapter handles its backend until detached", async () => {
  const source = { projectId: "p", backend: "custom", turns: chatTurns() };
  const detach = registerTrajectoryAdapter({
    id: "custom",
    label: "Custom",
    backends: [source.backend],
    generate: () => ({ data: trajectoryFromTurns(source.turns), title: "Из адаптера" }),
  });
  try {
    const generated = await generateTrajectoryDocument(source);
    expect(generated).toMatchObject({ adapter: "custom", document: { title: "Из адаптера" } });
  } finally {
    detach();
  }
  expect((await generateTrajectoryDocument(source)).adapter).toBe("turns");
});

test("the session command opens an OpenCode document and includes compaction in usage", async () => {
  const commands = new Map();
  const openTab = vi.fn();
  registerTrajectoryCommands({
    register: (id, title, run) => commands.set(id, run),
    projectId: "p",
    openTab,
    showPanel: () => {},
    mobile: () => false,
  });
  const payload = {
    title: "Сессия OpenCode",
    subtitle: "OpenCode · test/model",
    source: "opencode",
    data: {
      turns: [
        {
          number: 1,
          records: [
            { id: "u", kind: "user", title: "Почему?" },
            {
              id: "s",
              kind: "assistant",
              title: "Шаг 1",
              status: "done",
              durationMs: 2_000,
              timing: { ttftMs: 800, decodingMs: 1_200 },
              usage: { input: 10, output: 5, cost: 0.01 },
            },
            {
              id: "c",
              kind: "compaction",
              title: "Сжатие",
              usage: { input: 20, output: 2, cost: 0.02 },
            },
          ],
        },
      ],
      capabilities: { steps: true, ttft: true, usage: true, costs: true },
    },
  };
  const fetch = vi.fn(async (url, init) => {
    expect(url).toBe("/api/opencode/trajectory");
    expect(JSON.parse(init.body)).toEqual({ projectId: "p", sessionId: "ses" });
    return Response.json(payload);
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const opened = await commands.get("ide.trajectory.session.open")({
      session: "ses",
      backend: "opencode",
    });
    expect(opened).toMatchObject({ surface: "tab", adapter: "opencode" });
    expect(openTab).toHaveBeenCalledWith(
      "trajectory",
      { id: opened.id, title: "Сессия OpenCode" },
      { preview: false },
    );
    expect(useTrajectoryDocument(opened.id).value.data.usage).toEqual({
      input: 30,
      output: 7,
      cost: 0.03,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

test("the older OpenCode schema falls back through the project-scoped route", async () => {
  const legacy = vi.fn(async (url, init) => {
    expect(url).toBe("/api/opencode/trajectory");
    const body = JSON.parse(init.body);
    if (body.format === "turns") return Response.json({ turns: chatTurns() });
    return Response.json({ error: "Нет данных о шагах" }, { status: 422 });
  });
  vi.stubGlobal("fetch", legacy);
  try {
    const fallback = await generateTrajectoryDocument({
      projectId: "p",
      backend: "opencode",
      session: "legacy",
    });
    expect(fallback.adapter).toBe("turns");
    expect(fallback.warning).toContain("Нет данных о шагах");
    expect(fallback.document.data.records.length).toBeGreaterThan(0);
    expect(JSON.parse(legacy.mock.calls[1][1].body)).toEqual({
      projectId: "p",
      sessionId: "legacy",
      format: "turns",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an out-of-project session never falls back to replaying the chat", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ error: "Сессия не найдена в проекте" }, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      generateTrajectoryDocument({
        projectId: "p",
        backend: "opencode",
        session: "other",
        turns: chatTurns(),
      }),
    ).rejects.toThrow("Сессия не найдена в проекте");
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an open OpenCode chat uses its active branch after rollback and after a new native session", async () => {
  const commands = new Map();
  registerTrajectoryCommands({
    register: (id, title, run) => commands.set(id, run),
    projectId: "review-project",
    openTab: () => {},
    showPanel: () => {},
    mobile: () => false,
  });
  const retained = { ...chatTurns()[1], detached: true, session: { id: "old-session" } };
  const turns = [chatTurns()[0], retained];
  const unregister = registerChat({
    key: "review-chat",
    projectId: "review-project",
    backend: "opencode",
    label: "Ветка",
    turns: () => turns,
    visible: () => true,
    busy: () => false,
  });
  const fetch = vi.fn(() => {
    throw new Error("Открытый чат не требует запроса");
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const generate = commands.get("ide.trajectory.session.generate");
    const before = await generate({ chat: "review-chat" });
    expect(before).toMatchObject({ adapter: "turns", title: "Ветка", counts: { turns: 1 } });

    turns.push(turn({ id: "u2", text: "Продолжи в новой ветке" }), {
      ...turn({ id: "a2", role: "assistant" }),
      session: { id: "new-session" },
    });
    const after = await generate({ chat: "review-chat", adapter: "opencode" });
    expect(after).toMatchObject({ adapter: "turns", counts: { turns: 2 } });
    await expect(generate({ session: "old-session" })).rejects.toThrow("нужен backend");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    unregister();
    vi.unstubAllGlobals();
  }
});
