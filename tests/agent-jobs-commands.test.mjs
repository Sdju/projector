import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerBuiltinClientAgents } from "../src/app/agents.ts";
import { registerJobCommands } from "../src/modules/agent/model/job-commands.ts";

registerBuiltinClientAgents();

const commands = new Map();
const opened = [];
registerJobCommands(
  (id, _title, run, _enabled, _requires, meta) => commands.set(id, { run, meta }),
  "p1",
  { executeCommand: async (...args) => opened.push(args) },
);
const job = (extra = {}) => ({
  id: "aaaaaaaaaaaa",
  backend: "codex",
  task: "do",
  projectId: "p1",
  status: "running",
  rev: 3,
  files: [],
  pending: [],
  ...extra,
});
const reply = (body, ok = true) => ({ ok, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

test("the job commands are registered with descriptions for the agent", () => {
  for (const { meta } of commands.values()) expect(meta.description.length).toBeGreaterThan(20);
});

test("start sends the task of the project to the API and reports the job", async () => {
  const fetchMock = vi.fn(async () => reply({ job: job({ status: "queued" }) }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    commands.get("ide.agent.job.start").run({ agent: "nope", task: "x" }),
  ).rejects.toThrow(/agent/);
  await expect(commands.get("ide.agent.job.start").run({ agent: "codex" })).rejects.toThrow(/task/);
  const result = await commands
    .get("ide.agent.job.start")
    .run({ agent: "claude", task: "fix it", isolate: true });
  expect(result).toMatchObject({ job: "aaaaaaaaaaaa", status: "queued" });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/agent/jobs");
  expect(JSON.parse(init.body)).toMatchObject({
    projectId: "p1",
    backend: "claude-code",
    task: "fix it",
    isolate: true,
  });
});

test("result waits for a change only while the job is not finished and returns the full answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      return reply(
        url.includes("wait")
          ? { job: job({ status: "done", result: "x".repeat(9000), files: ["a.ts"] }), journal: [] }
          : { job: job(), journal: [] },
      );
    }),
  );
  const result = await commands.get("ide.agent.job.result").run({ job: "aaaaaaaaaaaa", wait: 500 });
  expect(result).toMatchObject({ status: "done", files: ["a.ts"], resultLength: 9000 });
  expect(result.result).toHaveLength(9000);
});

test("diff reports changed files, the stat and the patch", async () => {
  const fetchMock = vi.fn(async () =>
    reply({
      diff: {
        files: ["a.ts"],
        stat: " a.ts | 1 +",
        patch: "diff --git a/a.ts b/a.ts",
        truncated: false,
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await commands.get("ide.agent.job.diff").run({ job: "aaaaaaaaaaaa", limit: 5000 });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/agent/jobs/aaaaaaaaaaaa/diff?limit=5000");
  expect(result).toMatchObject({
    job: "aaaaaaaaaaaa",
    files: ["a.ts"],
    truncated: false,
  });
  expect(result.patch).toContain("a.ts");
});

test("log pairs tool calls with their results and cuts long ones", async () => {
  const journal = [
    { at: 1, event: "text", data: { text: "hi" } },
    { at: 2, event: "tool", data: { id: "t1", name: "Bash", input: { command: "npm test" } } },
    { at: 3, event: "tool-result", data: { id: "t1", name: "Bash", output: "ok" } },
    { at: 4, event: "tool", data: { id: "t2", name: "Read", input: { file_path: "a.ts" } } },
    { at: 5, event: "tool-result", data: { id: "t2", name: "Read", output: "x".repeat(2000) } },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply({ job: job({ status: "done" }), journal })),
  );
  const result = await commands.get("ide.agent.job.log").run({ job: "aaaaaaaaaaaa", tail: 20 });
  expect(result.status).toBe("done");
  expect(result.calls).toHaveLength(2);
  expect(result.calls[0]).toMatchObject({ id: "t1", name: "Bash", output: "ok" });
  expect(result.calls[1].output.length).toBeLessThan(1600);
  expect(result.cut).toBe(true);
});

test("answer sends option ids and free text but never a permission", async () => {
  const fetchMock = vi.fn(async () => reply({ job: job() }));
  vi.stubGlobal("fetch", fetchMock);
  const answer = commands.get("ide.agent.job.answer");
  const body = (index) => JSON.parse(fetchMock.mock.calls[index][1].body);
  await answer.run({
    job: "aaaaaaaaaaaa",
    request: "r1",
    answers: { q1: ["a", "b"] },
  });
  expect(body(0)).toEqual({ request: "r1", answers: { q1: ["a", "b"] } });
  await answer.run({ job: "aaaaaaaaaaaa", answers: null });
  expect(body(1)).toEqual({ answers: null });
  await answer.run({ job: "aaaaaaaaaaaa", answer: "своими словами" });
  expect(body(2)).toEqual({ text: "своими словами" });
  for (const patch of [
    { answer: "allow" },
    { answer: "always" },
    { answer: "deny" },
    { allow: true },
    { always: true },
  ])
    await expect(answer.run({ job: "aaaaaaaaaaaa", ...patch })).rejects.toThrow(/карточкой в чате/);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await expect(answer.run({ job: "aaaaaaaaaaaa" })).rejects.toThrow(/answers/);
  await expect(answer.run({ job: "aaaaaaaaaaaa", answers: { q1: "a" } })).rejects.toThrow(
    /answers/,
  );
  await commands.get("ide.agent.job.open").run({ job: "aaaaaaaaaaaa" });
  expect(opened[0]).toEqual([
    "ide.workbench.agent.job.open",
    { job: "aaaaaaaaaaaa" },
    { scope: "editor:p1" },
  ]);
});

test("worktree commands report, merge and discard the copy", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (url.endsWith("/worktree"))
      return reply({ worktree: { id: "abcdef12", branch: "projector/abcdef12", changed: 2 } });
    if (url.endsWith("/worktree/merge"))
      return reply({ merged: true, message: "Изменения влиты в проект, копия удалена" });
    return reply({ discarded: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  const status = await commands.get("ide.agent.job.worktree").run({ job: "aaaaaaaaaaaa" });
  expect(status).toMatchObject({
    job: "aaaaaaaaaaaa",
    worktree: { branch: "projector/abcdef12", changed: 2 },
  });
  const merged = await commands.get("ide.agent.job.merge").run({ job: "aaaaaaaaaaaa" });
  expect(merged).toMatchObject({ job: "aaaaaaaaaaaa", merged: true });
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  const discarded = await commands.get("ide.agent.job.discard").run({ job: "aaaaaaaaaaaa" });
  expect(discarded).toMatchObject({ job: "aaaaaaaaaaaa", discarded: true });
});

test("send and retry go to the API", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (url.endsWith("/send")) return reply({ accepted: true });
    if (url.endsWith("/retry"))
      return reply({ job: job({ id: "bbbbbbbbbbbb", status: "queued" }) });
    return reply({ accepted: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  const sent = await commands
    .get("ide.agent.job.send")
    .run({ job: "aaaaaaaaaaaa", text: "проверь тесты" });
  expect(sent).toEqual({ job: "aaaaaaaaaaaa", sent: true });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: "проверь тесты" });
  const retried = await commands.get("ide.agent.job.retry").run({ job: "aaaaaaaaaaaa" });
  expect(retried).toMatchObject({ job: "bbbbbbbbbbbb", status: "queued" });
  await commands.get("ide.agent.job.continue").run({ job: "aaaaaaaaaaaa", text: "добавь тест" });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    task: "добавь тест",
    append: true,
  });
});

test("result exposes request, question and option ids", async () => {
  const pending = {
    id: "r1",
    kind: "question",
    title: "Which?",
    custom: true,
    questions: [
      {
        id: "q1",
        question: "Which?",
        multiple: true,
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      reply({ job: job({ status: "needs-user", pending: [pending] }), journal: [] }),
    ),
  );
  const result = await commands.get("ide.agent.job.result").run({ job: "aaaaaaaaaaaa" });
  expect(result.waiting[0]).toMatchObject({
    request: "r1",
    custom: true,
    questions: [
      {
        id: "q1",
        multiple: true,
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    ],
  });
});
