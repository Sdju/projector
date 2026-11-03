import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ref } from "vue";
import { expect, test } from "vite-plus/test";
import { sideRequestFrom } from "../packages/server/modules/agent/side-request.ts";
import { projectorBackend } from "../packages/server/modules/agents/projector/projector-backend.ts";
import { sideAbort } from "../packages/server/modules/agents/projector/projector-side.ts";
import { btwQuestion } from "../packages/client/modules/agent/lib/side-command.ts";
import {
  sideHistory,
  useSideQuestion,
} from "../packages/client/modules/agent/model/side-question.ts";
import { scriptedModel } from "./helpers/scripted-model.mjs";

test("the /btw command takes the rest of the message", () => {
  expect(btwQuestion("/btw")).toBe("");
  expect(btwQuestion("/btw почему выбрали SQLite?")).toBe("почему выбрали SQLite?");
  expect(btwQuestion("  /btw\nчто сейчас делает агент  ")).toBe("что сейчас делает агент");
  expect(btwQuestion("привет /btw")).toBeUndefined();
  expect(btwQuestion("/btwfoo")).toBeUndefined();
});

test("a side request carries the visible history, earlier side questions and live state", () => {
  const request = sideRequestFrom({
    question: "завис ли процесс?",
    chat: "chat-1",
    projectId: "project-1",
    history: [
      { role: "user", content: "почини сборку" },
      {
        role: "assistant",
        content: "смотрю",
        tools: [{ id: "t1", name: "Bash", output: "exit 1", failed: true }],
      },
    ],
    thread: [{ question: "что делаем?", answer: "чиним сборку" }],
    running: [{ name: "Bash", input: '{"command":"vp build"}', startedAt: 1 }],
    plan: [{ content: "Запустить сборку", status: "in_progress" }],
  });
  expect(request.question).toBe("завис ли процесс?");
  expect(request.history).toHaveLength(2);
  expect(request.history[1].tools[0].failed).toBe(true);
  expect(request.message).toContain("Ранее в стороне спрашивали");
  expect(request.message).toContain("что делаем?");
  expect(request.message).toContain("Сейчас выполняется");
  expect(request.message).toContain("Bash");
  expect(request.message).toContain("Текущий план");
  expect(request.message).toContain("Запустить сборку");
  expect(request.message).toContain("Вопрос в сторону");
  expect(request.chat).toBe("chat-1");
  expect(request.projectId).toBe("project-1");
});

test("a side history leaves out the answer still being written but keeps its finished tools", () => {
  const turns = [
    { id: "u1", role: "user", text: "почини сборку", tools: [] },
    {
      id: "a1",
      role: "assistant",
      text: "ещё пишу ответ",
      tools: [
        {
          id: "t1",
          name: "Bash",
          status: "done",
          detail: "exit 1",
          input: '{"command":"vp build"}',
        },
        { id: "t2", name: "Read", status: "running", detail: "src/main.ts" },
      ],
    },
  ];
  const history = sideHistory(turns, true);
  expect(history[0]).toMatchObject({ role: "user", content: "почини сборку" });
  expect(history.at(-1)).toMatchObject({ role: "assistant", content: "" });
  expect(history.at(-1).tools).toHaveLength(1);
  expect(history.at(-1).tools[0].name).toBe("Bash");
  expect(JSON.stringify(history)).not.toContain("ещё пишу ответ");
  expect(JSON.stringify(sideHistory(turns, false))).toContain("ещё пишу ответ");
});

test("chat_status reports a waiting user before calling a run broken", async () => {
  const at = Date.now();
  const turns = ref([
    { id: "u1", role: "user", text: "почини сборку", tools: [], at },
    { id: "a1", role: "assistant", text: "жду разрешения", tools: [], at },
  ]);
  const side = useSideQuestion({
    chat: "chat-1",
    projectId: "project-1",
    backend: "projector",
    turns,
    busy: ref(true),
    phase: ref("думает"),
    lastEventAt: ref(Date.now()),
    permissions: ref([{ id: "p1", tool: "Bash", title: "Выполнить vp build", detail: "" }]),
    questions: ref([]),
    secrets: ref([]),
    queue: ref([]),
    selection: ref({}),
  });
  const status = await side.status();
  expect(status).toMatchObject({
    chat: "chat-1",
    backend: "projector",
    busy: true,
    health: "waiting-user",
    queue: { count: 0 },
    live: { found: false },
    pending: { permissions: [{ tool: "Bash", title: "Выполнить vp build" }] },
  });
  // The answer still being written is not exposed to the side agent.
  expect(status.lastAssistantText).toBeUndefined();
  expect(status.currentTools).toStrictEqual([]);
});

test("chat_status distinguishes an unavailable live-run check from a missing run", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 500 });
  try {
    const side = useSideQuestion({
      chat: "chat-1",
      projectId: "project-1",
      backend: "projector",
      turns: ref([{ id: "a1", role: "assistant", text: "", tools: [], at: Date.now() }]),
      busy: ref(true),
      phase: ref("думает"),
      lastEventAt: ref(Date.now()),
      permissions: ref([]),
      questions: ref([]),
      secrets: ref([]),
      queue: ref([]),
      selection: ref({}),
    });
    const status = await side.status();
    expect(status.live).toStrictEqual({ found: false, checked: false });
    expect(status.health).toBe("quiet");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the side timeout aborts the whole request", async () => {
  const signal = sideAbort(undefined, 0.005);
  expect(signal.aborted).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(signal.aborted).toBe(true);
});

test("a side run uses only read-only tools, does not write history and does not create a run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-side-"));
  const model = await scriptedModel([
    { tool: "chat_status", args: {} },
    { text: "Процесс жив, событий нет 40 секунд." },
  ]);
  const old = Object.fromEntries(
    ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  Object.assign(process.env, {
    XDG_DATA_HOME: directory,
    OPENAI_URL: model.url,
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(model.url) && init?.body) requests.push(JSON.parse(init.body));
    return originalFetch(url, init);
  };
  const events = [];
  const commands = [];
  const request = sideRequestFrom({
    question: "завис ли процесс?",
    chat: "chat-1",
    projectId: "project-1",
    history: [
      { role: "user", content: "почини сборку" },
      { role: "assistant", content: "запускаю сборку" },
    ],
  });
  try {
    await projectorBackend.run({
      side: true,
      chat: "chat-1",
      scope: "editor:project-1",
      projectId: "project-1",
      cwd: directory,
      message: request.message,
      history: request.history,
      commands: async (request) => {
        commands.push(request);
        return {
          chat: "chat-1",
          busy: true,
          phase: "думает",
          health: "quiet",
          sinceLastEventMs: 40_000,
          live: { found: true },
        };
      },
      emit(event, data) {
        events.push({ event, data });
      },
    });
    expect(commands).toStrictEqual([
      {
        operation: "execute",
        command: "ide.agent.chat.status",
        scope: "editor:project-1",
        args: { chat: "chat-1" },
      },
    ]);
    expect(events.some((item) => item.event === "tool" && item.data.name === "chat_status")).toBe(
      true,
    );
    expect(events.find((item) => item.event === "done")?.data.text).toContain("Процесс жив");
    expect(events.some((item) => item.event === "permission-request")).toBe(false);
    expect(events.some((item) => item.event === "question-request")).toBe(false);
    expect(events.some((item) => item.event === "secret-request")).toBe(false);
    expect(events.some((item) => item.event === "run")).toBe(false);
    expect(events.some((item) => item.event === "session")).toBe(false);
    const tools = requests[0].tools.map((tool) => tool.function.name);
    expect(tools).toContain("chat_status");
    expect(tools).toContain("list_chats");
    expect(tools).not.toContain("bash");
    expect(tools).not.toContain("execute_command");
    expect(tools).not.toContain("web_search");
    expect(requests[0].messages.at(-1).content).toContain("Вопрос в сторону");
    await expect(stat(join(directory, "projector/agent/history.sqlite"))).rejects.toThrow();
    await expect(stat(join(directory, "projector/agent/runs"))).rejects.toThrow();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await model.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
