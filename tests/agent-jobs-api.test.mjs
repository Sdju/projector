import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
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
    if (options.message === "write")
      await writeFile(join(options.cwd, "fork.txt"), "made by the job\n");
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
    terminal: { program: "codex", executable: "codex", title: "Codex" },
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
    await start({
      projectId: "p1",
      backend: "fake-api",
      task: "do it",
      mode: "plan",
      origin: "projector:chat",
    })
  ).json();
  expect(created.job).toMatchObject({
    backend: "fake-api",
    projectId: "p1",
    cwd: work,
    origin: "projector:chat",
  });
  const done = await until(async () => {
    const body = await (await request(`/api/agent/jobs/${created.job.id}`)).json();
    return body.job.status === "done" ? body : undefined;
  });
  expect(done.job.result).toBe("ok");
  expect(done.journal.map((entry) => entry.event)).toContain("text");
  // The mode reaches the agent both as a permission mode and as a selection, whatever its kind.
  expect(seen[0].selection).toEqual({ mode: "plan", "permission-mode": "plan" });
  expect(seen[0].mode).toBe("plan");

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

test("a job reports an unsupported follow-up and can be retried in place", async () => {
  const start = async (task) =>
    (
      await (
        await request("/api/agent/jobs", "POST", { projectId: "p1", backend: "fake-api", task })
      ).json()
    ).job;
  const job = await start("hang");
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${job.id}`)).json()).job.status === "running",
  );
  const sent = await request(`/api/agent/jobs/${job.id}/send`, "POST", { text: "ещё" });
  expect(sent.status).toBe(200);
  expect((await sent.json()).accepted).toBe(false);
  await request(`/api/agent/jobs/${job.id}/stop`, "POST", {});
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${job.id}`)).json()).job.status === "stopped",
  );
  // A finished job takes a follow-up as a new run in the same record and session.
  const again = await request(`/api/agent/jobs/${job.id}/send`, "POST", { text: "ещё раз" });
  expect(again.status).toBe(200);
  const followUp = await again.json();
  expect(followUp).toMatchObject({ accepted: true, continued: true });
  expect(followUp.job.id).toBe(job.id);
  const followed = await until(async () => {
    const body = await (await request(`/api/agent/jobs/${job.id}`)).json();
    return body.job.status === "done" ? body : undefined;
  });
  expect(followed.job.result).toBe("ok");
  expect(
    followed.journal.filter((entry) => entry.event === "input").map((entry) => entry.data.text),
  ).toContain("ещё раз");
  const retried = await request(`/api/agent/jobs/${job.id}/retry`, "POST", {
    task: "продолжай",
  });
  expect(retried.status).toBe(201);
  const next = (await retried.json()).job;
  expect(next).toMatchObject({ task: "продолжай", projectId: "p1", backend: "fake-api" });
  expect(next.id).not.toBe(job.id);
  await request(`/api/agent/jobs/${next.id}/stop`, "POST", {});
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${next.id}`)).json()).job.status === "stopped",
  );
});

test("a fork starts a second copy from the job's current state", async () => {
  const started = await (
    await request("/api/agent/jobs", "POST", {
      projectId: "p1",
      backend: "fake-api",
      task: "write",
      isolate: true,
    })
  ).json();
  const job = started.job;
  await until(async () => {
    const body = await (await request(`/api/agent/jobs/${job.id}`)).json();
    return body.job.status === "done" ? body : undefined;
  });
  const forked = await (await request(`/api/agent/jobs/${job.id}/fork`, "POST", {})).json();
  const copy = forked.job;
  expect(copy.id).not.toBe(job.id);
  expect(copy.cwd).not.toBe(job.cwd);
  expect(copy.worktree.branch).not.toBe(job.worktree.branch);
  expect(copy.worktree.branch).toMatch(/^projector\//);
  await until(
    async () => (await (await request(`/api/agent/jobs/${copy.id}`)).json()).job.status === "done",
  );
  expect(await readFile(join(copy.cwd, "fork.txt"), "utf8")).toBe("made by the job\n");
  // The original copy stays where it was.
  expect((await (await request(`/api/agent/jobs/${job.id}`)).json()).job.worktree.branch).toBe(
    job.worktree.branch,
  );
});

test("a job in an isolated copy works there and can be stopped", async () => {
  const start = async (task, extra = {}) =>
    request("/api/agent/jobs", "POST", { projectId: "p1", backend: "fake-api", task, ...extra });
  const job = (await (await start("hang", { isolate: true })).json()).job;
  expect(job.worktree.branch).toMatch(/^projector\//);
  expect(job.cwd).not.toBe(work);
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${job.id}`)).json()).job.status === "running",
  );

  // A long poll returns at once when the status moves.
  const poll = request(`/api/agent/jobs/${job.id}?wait=30&rev=${job.rev + 100}`);
  const stopped = await request(`/api/agent/jobs/${job.id}/stop`, "POST", {});
  expect(stopped.status).toBe(200);
  expect((await poll).status).toBe(200);
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${job.id}`)).json()).job.status === "stopped",
  );

  // The copy is visible; a retry takes it over, so the old record loses it and cannot merge it.
  const copy = await (await request(`/api/agent/jobs/${job.id}/worktree`)).json();
  expect(copy.worktree).toMatchObject({ branch: job.worktree.branch });
  const retried = await request(`/api/agent/jobs/${job.id}/retry`, "POST", { task: "hang" });
  expect(retried.status).toBe(201);
  const next = (await retried.json()).job;
  expect(next).toMatchObject({ cwd: job.cwd, worktree: { branch: job.worktree.branch } });
  expect(next.id).not.toBe(job.id);
  expect((await (await request(`/api/agent/jobs/${job.id}`)).json()).job.worktree).toBeUndefined();
  expect((await request(`/api/agent/jobs/${job.id}/worktree/merge`, "POST", {})).status).toBe(400);
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${next.id}`)).json()).job.status === "running",
  );
  await request(`/api/agent/jobs/${next.id}/stop`, "POST", {});
  await until(
    async () =>
      (await (await request(`/api/agent/jobs/${next.id}`)).json()).job.status === "stopped",
  );
  const nextCopy = await (await request(`/api/agent/jobs/${next.id}/worktree`)).json();
  expect(nextCopy.worktree).toMatchObject({ branch: job.worktree.branch });
  const merged = await (
    await request(`/api/agent/jobs/${next.id}/worktree/merge`, "POST", {})
  ).json();
  expect(merged.merged).toBe(false);
  expect((await (await request(`/api/agent/jobs/${next.id}`)).json()).job.worktree).toBeUndefined();
  expect((await (await request(`/api/agent/jobs/${next.id}/worktree`)).json()).worktree).toBeNull();
  await until(async () =>
    (await (await request("/api/agent/jobs")).json()).jobs.every(
      (item) => item.status !== "running" && item.status !== "queued",
    ),
  );
});
