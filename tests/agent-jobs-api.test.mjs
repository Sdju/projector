import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";

const root = await realpath(await mkdtemp(join(tmpdir(), "projector-jobs-api-")));
const work = join(root, "work");
process.env.XDG_DATA_HOME = join(root, "data");
await mkdir(join(root, "data", "projector"), { recursive: true });
await mkdir(work, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: work });
git("init", "-q", "-b", "main");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
await writeFile(join(work, "a.txt"), "1\n");
git("add", "-A");
git("commit", "-qm", "init");
await writeFile(
  join(root, "data", "projector", "projects.json"),
  JSON.stringify({ projects: [{ id: "p1", name: "work", path: work, commands: [] }] }),
);

const { registerAgentBackend } = await import("../server/modules/agent/index.ts");
const seen = [];
registerAgentBackend({
  id: "fake-api",
  label: "Fake API",
  program: "fake-chat",
  capabilities: { hosted: true },
  async run(options) {
    seen.push({ cwd: options.cwd, selection: options.selection, mode: options.permissionMode });
    options.emit("text", { text: "hi" });
    if (options.message === "hang") {
      if (!options.abort.aborted)
        await new Promise((resolve) =>
          options.abort.addEventListener("abort", resolve, { once: true }),
        );
      return;
    }
    options.emit("done", { text: "ok" });
  },
});
registerAgentBackend({
  id: "fake-missing",
  label: "Fake Missing",
  capabilities: { hosted: true },
  available: () => false,
  run: async () => {},
});
registerAgentBackend({ id: "fake-local", label: "Fake Local", run: async () => {} });

const { handleApi } = await import("../server/app/api.ts");
const server = createServer((req, res) => void handleApi(req, res));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const request = (path, method = "GET", body, origin = base) =>
  fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
const until = async (check, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition not met in time");
};

test("the agent catalog and chat programs come from the backend registry", async () => {
  const backends = (await (await request("/api/agent/backends")).json()).backends;
  expect(backends.find((item) => item.id === "codex")).toMatchObject({
    label: "Codex",
    program: "codex",
  });
  expect(backends.find((item) => item.id === "projector").builtin).toBe(true);

  const modes = await (await request("/api/agent/modes")).json();
  expect(modes.programs).toContain("claude");
  expect(modes.programs).toContain("kimi");
  expect(modes.programs).not.toContain("shell");
});

test("the jobs API validates what a client sends and runs a job to its answer", async () => {
  const start = (body, origin) => request("/api/agent/jobs", "POST", body, origin);
  const refused = async (body, pattern) => {
    const response = await start(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(pattern);
  };
  await refused({ projectId: "p1", backend: "projector", task: "x" }, /внешнего агента/);
  await refused({ projectId: "p1", backend: "nope", task: "x" }, /внешнего агента/);
  await refused({ projectId: "p1", backend: "fake-local", task: "x" }, /в фоне/);
  await refused({ projectId: "p1", backend: "fake-missing", task: "x" }, /не установлена/);
  await refused({ projectId: "p1", backend: "fake-api", task: "  " }, /Опишите/);
  await refused({ projectId: "p1", backend: "fake-api", task: "x".repeat(20_001) }, /длиннее/);
  await refused({ projectId: "nope", backend: "fake-api", task: "x" }, /Проект не найден/);
  // Starting is for the Projector page only: no Origin, no job.
  expect((await start({ projectId: "p1", backend: "fake-api", task: "x" }, "")).status).toBe(403);
  expect(
    (await start({ projectId: "p1", backend: "fake-api", task: "x" }, "http://evil.example"))
      .status,
  ).toBe(403);

  const created = await (
    await start({ projectId: "p1", backend: "fake-api", task: "do it", mode: "plan" })
  ).json();
  expect(created.job).toMatchObject({ backend: "fake-api", projectId: "p1", cwd: work });
  const done = await until(async () => {
    const body = await (await request(`/api/agent/jobs/${created.job.id}`)).json();
    return body.job.status === "done" ? body : undefined;
  });
  expect(done.job.result).toBe("ok");
  expect(done.journal.map((entry) => entry.event)).toContain("text");
  // ACP-style agents take the mode as a selection.
  expect(seen[0].selection).toEqual({ mode: "plan" });

  const list = await (await request("/api/agent/jobs?projectId=p1")).json();
  expect(list.jobs[0]).toMatchObject({ id: created.job.id, status: "done", resultPreview: "ok" });
  expect(list.jobs[0].result).toBeUndefined();
  expect((await (await request("/api/agent/jobs?projectId=x")).json()).jobs).toEqual([]);

  expect((await request("/api/agent/jobs/aaaaaaaaaaaa")).status).toBe(404);
  expect((await request("/api/agent/jobs/zzz")).status).toBe(404);
  expect((await request(`/api/agent/jobs/${created.job.id}/stop`, "POST", {}, "")).status).toBe(
    403,
  );
  const answer = await request(`/api/agent/jobs/${created.job.id}/answer`, "POST", { text: "да" });
  expect(answer.status).toBe(400);

  expect((await request(`/api/agent/jobs/${created.job.id}`, "DELETE", undefined, "")).status).toBe(
    403,
  );
  expect((await request(`/api/agent/jobs/${created.job.id}`, "DELETE")).status).toBe(200);
  expect((await request(`/api/agent/jobs/${created.job.id}`)).status).toBe(404);
});

test("a job in an isolated copy works there, can be stopped, and the limit is reported", async () => {
  const start = async (task, extra = {}) =>
    request("/api/agent/jobs", "POST", { projectId: "p1", backend: "fake-api", task, ...extra });
  const job = (await (await start("hang", { isolate: true })).json()).job;
  expect(job.worktree.branch).toMatch(/^projector\//);
  expect(job.cwd).not.toBe(work);
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${job.id}`)).json()).job.status === "running",
  );

  const more = [];
  for (let index = 0; index < 3; index++) more.push((await (await start("hang")).json()).job);
  const over = await start("hang");
  expect(over.status).toBe(400);
  expect((await over.json()).error).toMatch(/Уже работает 4/);

  // A long poll returns at once when the status moves.
  const poll = request(`/api/agent/jobs/${job.id}?wait=30&rev=${job.rev + 100}`);
  const stopped = await request(`/api/agent/jobs/${job.id}/stop`, "POST", {});
  expect(stopped.status).toBe(200);
  expect((await poll).status).toBe(200);
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${job.id}`)).json()).job.status === "stopped",
  );
  for (const item of more) await request(`/api/agent/jobs/${item.id}/stop`, "POST", {});
  await until(async () =>
    (await (await request("/api/agent/jobs")).json()).jobs.every(
      (item) => item.status !== "running" && item.status !== "queued",
    ),
  );
});
