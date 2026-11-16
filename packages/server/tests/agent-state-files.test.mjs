import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, expect, test, vi } from "vite-plus/test";

// Каждый файл тестов живёт в своём процессе, поэтому данные Projector уводятся в tmp.
const root = await mkdtemp(join(tmpdir(), "projector-state-files-"));
const previous = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = join(root, "data");

const jobs = await import("../modules/agent/jobs-store.ts");
const runs = await import("../modules/agent/agent-runs.ts");
const records = await import("../modules/agent/run-record.ts");
const recent = await import("../modules/agent/recent-runs.ts");
const stateFiles = await import("../modules/agent/state-file.ts");

afterAll(async () => {
  process.env.XDG_DATA_HOME = previous;
  await rm(root, { recursive: true, force: true });
});

const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );

/** Копии, которые `setAsideBroken` оставил рядом с файлом. */
const shelved = async (file) =>
  (await readdir(dirname(file))).filter((name) => name.startsWith(`${basename(file)}.broken-`));

/** Выполняет работу с подавленным выводом в stderr и возвращает то, что в него попало. */
async function quiet(work) {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const value = await work();
    return { value, messages: spy.mock.calls.flat().map(String).join("\n") };
  } finally {
    spy.mockRestore();
  }
}

const jobFile = (id) => join(jobs.jobDirectory(id), "job.json");
const journalFile = (id) => join(jobs.jobDirectory(id), "journal.json");
const runFile = (id) => join(runs.runDirectory(id), "run.json");

const runRecord = (overrides = {}) => ({
  backend: "kimi",
  message: "m",
  history: [],
  ...overrides,
});

const jobRecord = (id, overrides = {}) => ({
  id,
  backend: "fake",
  task: "t",
  projectId: "p",
  cwd: root,
  unattended: false,
  status: "running",
  rev: 1,
  createdAt: 1,
  result: "",
  files: [],
  pending: [],
  ...overrides,
});

test("отсутствие job.json — штатное отсутствие задания, без диагностики", async () => {
  const file = jobFile("aaaaaaaaaaaa");
  const { value, messages } = await quiet(() => jobs.loadJob("aaaaaaaaaaaa"));
  expect(value).toBeNull();
  expect(messages).toBe("");
  expect(await exists(file)).toBe(false);
});

test("повреждённый job.json откладывается и не выглядит отсутствующим", async () => {
  const id = "bbbbbbbbbbbb";
  const file = jobFile(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "{ broken");
  const { value, messages } = await quiet(() => jobs.loadJob(id));
  expect(value).toBeNull();
  expect(messages).toContain(file);
  expect(messages).toContain("повреждён");
  expect(await exists(file)).toBe(false);
  expect(await shelved(file)).toHaveLength(1);
});

test("валидный JSON неверной формы считается повреждённым job.json", async () => {
  const id = "cccccccccccc";
  const file = jobFile(id);
  await mkdir(dirname(file), { recursive: true });
  // Синтаксис верный, но обязательных полей задания нет.
  await writeFile(file, JSON.stringify({ id, backend: "fake", status: "running" }));
  let read = await quiet(() => jobs.loadJob(id));
  expect(read.value).toBeNull();
  expect(read.messages).toContain("неверный формат");
  expect(await shelved(file)).toHaveLength(1);
  expect(await exists(file)).toBe(false);

  // Мусор в обязательном массиве тоже не должен попасть в рантайм.
  const valid = {
    id,
    backend: "fake",
    task: "t",
    projectId: "p",
    cwd: root,
    unattended: false,
    status: "running",
    rev: 1,
    createdAt: Date.now(),
    result: "",
    files: [42],
    pending: [],
  };
  await writeFile(file, JSON.stringify(valid));
  read = await quiet(() => jobs.loadJob(id));
  expect(read.value).toBeNull();
  expect(await shelved(file)).toHaveLength(2);
});

test("повреждённое задание не затирается следующей записью", async () => {
  const id = "dddddddddddd";
  const file = jobFile(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ id, status: "done" }));
  await quiet(() => jobs.loadJob(id));
  const [backup] = await shelved(file);
  const saved = await readFile(join(dirname(file), backup), "utf8");
  expect(JSON.parse(saved)).toEqual({ id, status: "done" });

  await jobs.saveJob({
    id,
    backend: "fake",
    task: "t",
    projectId: "p",
    cwd: root,
    messageId: "m",
    unattended: false,
    status: "queued",
    rev: 1,
    createdAt: Date.now(),
    result: "",
    files: [],
    pending: [],
  });
  expect((await jobs.loadJob(id)).status).toBe("queued");
  expect(await shelved(file)).toHaveLength(1);
});

test("журнал теряет только негодные записи, файл остаётся как есть", async () => {
  const id = "eeeeeeeeeeee";
  const file = journalFile(id);
  await mkdir(dirname(file), { recursive: true });
  const entries = [
    { at: 1, event: "text", data: { text: "a" } },
    { at: "позже", event: "text", data: {} },
    { event: "done" },
  ];
  await writeFile(file, JSON.stringify(entries));
  const { value, messages } = await quiet(() => jobs.loadJournal(id));
  expect(value).toEqual([{ at: 1, event: "text", data: { text: "a" } }]);
  expect(messages).toContain("отброшено записей неверного формата: 2");
  expect(await shelved(file)).toHaveLength(0);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(entries);
});

test("журнал неверной формы целиком откладывается и читается пустым", async () => {
  const id = "ffffffffffff";
  const file = journalFile(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ entries: [] }));
  const { value, messages } = await quiet(() => jobs.loadJournal(id));
  expect(value).toEqual([]);
  expect(messages).toContain("имеет неверный формат");
  expect(await shelved(file)).toHaveLength(1);
});

test("run.json проверяется целиком, повреждённый файл откладывается", async () => {
  const id = "111111111111";
  const file = runFile(id);
  await mkdir(dirname(file), { recursive: true });
  // История хода негодная: без неё разговор продолжить нельзя.
  await writeFile(
    file,
    JSON.stringify({ backend: "kimi", message: "m", history: [{ role: "user" }] }),
  );
  const { value, messages } = await quiet(() => runs.readRun(id));
  expect(value).toBeNull();
  expect(messages).toContain("Файл хода");
  expect(await shelved(file)).toHaveLength(1);
  expect(await exists(file)).toBe(false);
});

test("штатная запись хода читается как раньше", async () => {
  const id = await runs.createRun({
    backend: "kimi",
    message: "m",
    history: [{ role: "user", content: "hi" }],
    chat: "chat",
    approvals: true,
  });
  const record = await runs.readRun(id);
  expect(record).toMatchObject({ backend: "kimi", message: "m", chat: "chat", approvals: true });
  const missing = await quiet(() => runs.readRun("222222222222"));
  expect(missing.value).toBeNull();
  expect(missing.messages).toBe("");
});

test("процесс хода не стартует без годной записи", async () => {
  const directory = await mkdtemp(join(root, "runner-"));
  const file = join(directory, "run.json");

  const missing = await records.requireRunRecord(directory).catch((error) => error);
  expect(missing).toBeInstanceOf(Error);
  expect(missing.message).toMatch(/Нет файла запуска/);
  expect(await shelved(file)).toHaveLength(0);

  await writeFile(file, "{ broken");
  const broken = await quiet(() => records.requireRunRecord(directory).catch((error) => error));
  expect(broken.value.message).toMatch(/непригоден/);
  expect(broken.messages).toContain("повреждён");
  expect(await shelved(file)).toHaveLength(1);
  expect(await exists(file)).toBe(false);

  await writeFile(file, JSON.stringify({ backend: "kimi", message: "m", history: [] }));
  expect(await records.requireRunRecord(directory)).toMatchObject({
    backend: "kimi",
    message: "m",
  });
});

test("вложенные поля run.json проверяются, неверные откладываются", async () => {
  const variants = [
    ["часть сообщения null", { parts: [null] }],
    ["часть сообщения неизвестного типа", { parts: [{ type: "mystery", text: "x" }] }],
    [
      "вызов инструмента без вывода",
      { history: [{ role: "user", content: "hi", tools: [{ id: "t", name: "read" }] }] },
    ],
    ["выбор модели не строкой", { selection: { model: 7 } }],
    ["настройки Judge неверные", { judge: { maxRisk: 9 } }],
    [
      "снимок роли с неверным выбором",
      { role: { roleId: "chat", name: "Роль", selection: { model: 7 } } },
    ],
  ];
  for (const [index, [label, overrides]] of variants.entries()) {
    const id = (0x333000000000 + index).toString(16);
    const file = runFile(id);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(runRecord(overrides)));
    const read = await quiet(() => runs.readRun(id));
    expect(read.value, label).toBeNull();
    expect(read.messages, label).toContain("Файл хода");
    expect(await shelved(file), label).toHaveLength(1);
    expect(await exists(file), label).toBe(false);
  }
});

test("годные вложенные поля run.json не считаются повреждением", async () => {
  const id = (0x333000000010).toString(16);
  const file = runFile(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      runRecord({
        parts: [
          { type: "text", text: "посмотри" },
          { type: "file", path: "src/a.ts", range: { from: 1, to: 2 } },
          { type: "image", id: "i1", name: "a.png", mime: "image/png" },
          { type: "command", name: "test" },
        ],
        history: [
          {
            role: "assistant",
            content: "готово",
            thoughts: "проверяю",
            tools: [{ id: "t1", name: "read", input: "{}", output: "ok", failed: false }],
          },
        ],
        features: ["skills"],
        judge: { show: true, auto: false, maxRisk: 2, confidence: "high-medium" },
        role: {
          roleId: "chat",
          name: "Роль",
          selection: { model: "m" },
          permissionMode: "auto",
          skills: ["s"],
          mcp: [],
        },
        selection: { model: "m" },
        approvals: true,
      }),
    ),
  );
  const read = await quiet(() => runs.readRun(id));
  expect(read.messages).toBe("");
  expect(read.value).toMatchObject({
    backend: "kimi",
    message: "m",
    features: ["skills"],
    approvals: true,
  });
  expect(await shelved(file)).toHaveLength(0);
});

test("вложенные поля job.json проверяются, неверные откладываются", async () => {
  const variants = [
    ["карточка ожидания null", { pending: [null] }],
    [
      "вариант ответа не объект",
      {
        pending: [
          {
            id: "q1",
            kind: "question",
            title: "?",
            questions: [{ id: "one", question: "?", options: [null], multiple: false }],
          },
        ],
      },
    ],
    [
      "вопрос без признака множественности",
      {
        pending: [
          {
            id: "q2",
            kind: "question",
            title: "?",
            questions: [{ id: "one", question: "?", options: [] }],
          },
        ],
      },
    ],
    ["выбор модели не строкой", { selection: { model: 7 } }],
    [
      "снимок роли с неверным выбором",
      { role: { roleId: "chat", name: "Р", selection: { model: 7 } } },
    ],
    ["worktree без ветки", { worktree: { id: "w1" } }],
    ["режим разрешений не строкой", { permissionMode: 3 }],
  ];
  for (const [index, [label, overrides]] of variants.entries()) {
    const id = (0x444000000000 + index).toString(16);
    const file = jobFile(id);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(jobRecord(id, overrides)));
    const read = await quiet(() => jobs.loadJob(id));
    expect(read.value, label).toBeNull();
    expect(read.messages, label).toContain("Файл задания");
    expect(await shelved(file), label).toHaveLength(1);
    expect(await exists(file), label).toBe(false);
  }
});

test("годные вложенные поля job.json не считаются повреждением", async () => {
  const id = (0x444000000010).toString(16);
  const file = jobFile(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      jobRecord(id, {
        pending: [
          {
            id: "p1",
            kind: "permission",
            title: "Разрешение",
            tool: "shell",
            detail: "ls",
            persistent: true,
            judge: { score: 2, label: "низкий", reason: "ok", confidence: "high" },
          },
          {
            id: "q1",
            kind: "question",
            title: "Вопрос",
            questions: [
              {
                id: "one",
                question: "Что?",
                header: "H",
                options: [{ id: "a", label: "A", description: "d" }],
                multiple: false,
                custom: true,
                optional: true,
              },
            ],
            custom: true,
          },
        ],
        selection: { model: "m" },
        role: {
          roleId: "chat",
          name: "Роль",
          selection: { model: "m" },
          permissionMode: "auto",
          prompt: "p",
          template: true,
          skills: ["s"],
          mcp: [],
        },
        worktree: { id: "w1", branch: "b" },
        history: [{ role: "user", content: "hi", tools: [{ id: "t", name: "read", output: "x" }] }],
        permissionMode: "auto",
        worktreeCleared: true,
      }),
    ),
  );
  const read = await quiet(() => jobs.loadJob(id));
  expect(read.messages).toBe("");
  expect(read.value).toMatchObject({ id, status: "running", permissionMode: "auto" });
  expect(read.value.pending).toHaveLength(2);
  expect(await shelved(file)).toHaveLength(0);
});

test("если повреждённый файл нельзя увести, чтение падает, а не врёт о копии", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const directory = join(root, "read-only");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "state.json");
  await writeFile(file, "{ broken");
  await chmod(directory, 0o500);
  try {
    await expect(stateFiles.readStateFile(file, "Тест", () => undefined)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{ broken");
    expect(await shelved(file)).toHaveLength(0);
  } finally {
    await chmod(directory, 0o700);
  }
});

test("список недавних запусков переживает испорченный файл с диагностикой", async () => {
  const data = join(root, "recent-data");
  const before = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = data;
  try {
    const file = join(data, "projector", "agent", "recent-runs.json");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "[ broken");
    const { value, messages } = await quiet(() => recent.listRecentRuns());
    expect(value).toEqual([]);
    expect(messages).toContain("Список недавних запусков");
    expect(await shelved(file)).toHaveLength(1);

    // Следующая запись заводит новый файл, испорченный остаётся рядом.
    await recent.recordRecentRun({
      id: "run-1",
      backend: "kimi",
      projectId: "p",
      chat: "c",
      topic: "t",
      status: "done",
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
    });
    expect((await recent.listRecentRuns()).map((item) => item.id)).toEqual(["run-1"]);
    expect(await shelved(file)).toHaveLength(1);
    expect(await exists(file)).toBe(true);
  } finally {
    process.env.XDG_DATA_HOME = before;
  }
});
