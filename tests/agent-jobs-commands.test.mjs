import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerJobCommands } from "../src/modules/agent/model/job-commands.ts";

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
  expect([...commands.keys()]).toEqual([
    "ide.agent.job.start",
    "ide.agent.jobs.list",
    "ide.agent.job.result",
    "ide.agent.job.stop",
    "ide.agent.job.answer",
    "ide.agent.job.open",
  ]);
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

test("result waits for a change only while the job is not finished and bounds the answer", async () => {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      calls.push(url);
      return reply(
        url.includes("wait")
          ? { job: job({ status: "done", result: "x".repeat(9000), files: ["a.ts"] }), journal: [] }
          : { job: job(), journal: [] },
      );
    }),
  );
  const result = await commands.get("ide.agent.job.result").run({ job: "aaaaaaaaaaaa", wait: 500 });
  expect(calls).toEqual([
    "/api/agent/jobs/aaaaaaaaaaaa",
    "/api/agent/jobs/aaaaaaaaaaaa?wait=45&rev=3",
  ]);
  expect(result).toMatchObject({ status: "done", files: ["a.ts"], resultCut: true });
  expect(result.result.length).toBeLessThan(8100);
});

test("answer and open go to the job", async () => {
  const fetchMock = vi.fn(async () => reply({ job: job() }));
  vi.stubGlobal("fetch", fetchMock);
  await commands.get("ide.agent.job.answer").run({ job: "aaaaaaaaaaaa", answer: "allow" });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/agent/jobs/aaaaaaaaaaaa/answer");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: "allow" });
  await commands.get("ide.agent.job.open").run({ job: "aaaaaaaaaaaa" });
  expect(opened[0]).toEqual([
    "ide.workbench.agent.job.open",
    { job: "aaaaaaaaaaaa" },
    { scope: "editor:p1" },
  ]);
});
