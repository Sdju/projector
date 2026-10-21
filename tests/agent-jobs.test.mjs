import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory;
let folder;
let previous;
let jobs;
let runs;
let store;
let attached;

async function until(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("condition not met in time");
}

// A scripted backend: the task text picks what it does. No real CLI is started.
const fake = {
  id: "fake-job",
  capabilities: { hosted: true },
  async run(options) {
    attached.push({
      attach: options.run?.attach,
      approvals: !!options.approve,
      bridge: !!options.commands,
    });
    const { emit } = options;
    emit("session", { id: "sess-1", backend: "fake-job" });
    const task = options.message;
    if (task === "hang") {
      emit("text", { text: "working" });
      if (!options.abort.aborted)
        await new Promise((resolve) =>
          options.abort.addEventListener("abort", resolve, { once: true }),
        );
      return;
    }
    if (task === "fail") {
      emit("error", { error: "boom" });
      return;
    }
    if (task === "ask") {
      const allowed = await options.approve({
        tool: "bash",
        input: { command: "ls" },
        title: "Run ls",
      });
      const answers = await options.ask({
        questions: [
          { id: "q1", question: "Which?", options: [{ id: "a", label: "A" }], multiple: false },
        ],
        custom: true,
      });
      emit("text", { text: `allowed=${allowed} answers=${JSON.stringify(answers)}` });
      emit("done", { text: `allowed=${allowed} answers=${JSON.stringify(answers)}` });
      return;
    }
    emit("text", { text: "hel" });
    emit("text", { text: "lo" });
    emit("tool", {
      id: "t1",
      name: "Write",
      input: { file_path: join(options.cwd, "made.txt"), content: "x" },
    });
    emit("tool-result", { id: "t1", name: "Write", output: "ok" });
    await writeFile(join(options.cwd, "made.txt"), "x");
    emit("done", { text: "final answer" });
  },
};

beforeAll(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "projector-jobs-")));
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(directory, "data");
  folder = join(directory, "project");
  await mkdir(folder, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: folder });
  execFileSync("git", ["config", "user.name", "t"], { cwd: folder });
  await writeFile(join(folder, "a.txt"), "one\n");
  execFileSync("git", ["add", "-A"], { cwd: folder });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: folder });
  const agent = await import("../server/modules/agent/index.ts");
  agent.registerAgentBackend(fake);
  jobs = agent;
  runs = agent;
  store = await import("../server/modules/agent/jobs-store.ts");
  attached = [];
});
afterAll(async () => {
  process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const start = (task, extra = {}) =>
  jobs.startJob({ backend: "fake-job", task, projectId: "p1", cwd: folder, ...extra });
const settled = (id) =>
  until(async () => {
    const found = await jobs.readJob(id);
    return found && jobs.isFinished(found.job.status) ? found : undefined;
  });

describe("background agent jobs", () => {
  it("runs a task without a client and keeps the journal, answer and changed files", async () => {
    const job = await start("quick");
    expect(job.status).toBe("queued");
    const { job: done, journal } = await settled(job.id);
    expect(done.status).toBe("done");
    expect(done.result).toBe("final answer");
    expect(done.sessionId).toBe("sess-1");
    expect(done.files).toContain("made.txt");
    expect(done.pending).toEqual([]);
    // Text deltas are one entry; the journal keeps the chat event names.
    expect(journal.filter((entry) => entry.event === "text")).toHaveLength(1);
    expect(journal.find((entry) => entry.event === "text").data.text).toBe("hello");
    expect(journal.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(["tool", "tool-result", "status"]),
    );
    // The command bridge of Projector is never offered; the run record is collected.
    expect(attached.at(-1)).toMatchObject({ attach: false, approvals: true, bridge: false });
    expect(await runs.readRun(done.runId)).toBeNull();
    // It is on disk, so it outlives the server.
    expect((await store.loadJob(job.id)).status).toBe("done");
    expect((await jobs.listJobs("p1")).map((item) => item.id)).toContain(job.id);
    expect(await jobs.listJobs("other")).toEqual([]);
  });

  it("turns a permission and a question into needs-user and goes on after the answers", async () => {
    const job = await start("ask");
    const waiting = async (kind) =>
      until(async () => {
        const { job: now } = await jobs.readJob(job.id);
        return now.status === "needs-user" && now.pending[0]?.kind === kind ? now : undefined;
      });
    const permission = await waiting("permission");
    expect(permission.pending[0]).toMatchObject({ title: "Run ls" });
    const after = await jobs.answerJob(job.id, { text: "да" });
    expect(after.pending).toEqual([]);
    const question = await waiting("question");
    expect(question.pending[0].questions[0].id).toBe("q1");
    await jobs.answerJob(job.id, { request: question.pending[0].id, text: "A" });
    const { job: done, journal } = await settled(job.id);
    expect(done.result).toBe('allowed=true answers={"q1":["A"]}');
    expect(journal.filter((entry) => entry.event === "answer")).toHaveLength(2);
    await expect(jobs.answerJob(job.id, { text: "да" })).rejects.toThrow();
  });

  it("refuses a permission when the answer is no, and skips it when unattended it allows", async () => {
    const job = await start("ask");
    await until(async () => (await jobs.readJob(job.id)).job.pending.length === 1);
    await jobs.answerJob(job.id, { allow: false });
    await until(async () => (await jobs.readJob(job.id)).job.pending[0]?.kind === "question");
    await jobs.answerJob(job.id, { answers: null });
    expect((await settled(job.id)).job.result).toBe("allowed=false answers=null");

    const free = await start("ask", { unattended: true });
    expect((await settled(free.id)).job.result).toBe("allowed=true answers=null");
  });

  it("stops a working job", async () => {
    const job = await start("hang");
    await until(async () => (await jobs.readJob(job.id)).job.status === "running");
    await jobs.stopJob(job.id);
    const { job: done } = await settled(job.id);
    expect(done.status).toBe("stopped");
    expect(done.result).toBe("working");
  });

  it("reports an agent failure", async () => {
    const job = await start("fail");
    const { job: done } = await settled(job.id);
    expect(done.status).toBe("error");
    expect(done.error).toBe("boom");
  });

  it("limits the jobs working at once", async () => {
    const started = [];
    for (let index = 0; index < jobs.MAX_RUNNING_JOBS; index++) started.push(await start("hang"));
    expect(() => jobs.assertJobSlot()).toThrow(/Уже работает/);
    await expect(start("hang")).rejects.toThrow(/Уже работает/);
    for (const job of started) await jobs.stopJob(job.id);
    for (const job of started) await settled(job.id);
    expect(() => jobs.assertJobSlot()).not.toThrow();
  });

  it("wakes a long poll when the status changes", async () => {
    const job = await start("hang");
    const running = await until(async () => {
      const found = await jobs.readJob(job.id);
      return found.job.status === "running" ? found.job : undefined;
    });
    const waiting = jobs.waitForJob(job.id, running.rev, 30);
    setTimeout(() => void jobs.stopJob(job.id), 50);
    const woken = await waiting;
    expect(woken.job.rev).toBeGreaterThan(running.rev);
    await settled(job.id);
    // A finished job answers at once.
    const started = Date.now();
    await jobs.waitForJob(job.id, 999, 30);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("takes over unfinished jobs after a restart, once, rejoining their run", async () => {
    const runId = await runs.createRun({
      backend: "fake-job",
      message: "quick",
      history: [],
      cwd: folder,
      chat: "job:aaaaaaaaaaaa",
    });
    await store.saveJob({
      id: "aaaaaaaaaaaa",
      backend: "fake-job",
      task: "quick",
      projectId: "p1",
      cwd: folder,
      unattended: false,
      status: "needs-user",
      rev: 5,
      createdAt: Date.now(),
      runId,
      result: "",
      files: [],
      pending: [{ id: "stale", kind: "permission", title: "old" }],
    });
    // A run of a job is not listed as a second run.
    expect(await runs.listLiveRuns()).toEqual([]);
    await Promise.all([jobs.recoverJobs(), jobs.recoverJobs()]);
    const { job } = await settled("aaaaaaaaaaaa");
    expect(job.status).toBe("done");
    expect(job.pending).toEqual([]);
    expect(attached.filter((item) => item.attach === true)).toHaveLength(1);
  });

  it("marks a restarted job whose run is gone as failed", async () => {
    await store.saveJob({
      id: "bbbbbbbbbbbb",
      backend: "fake-job",
      task: "quick",
      projectId: "p1",
      cwd: folder,
      unattended: false,
      status: "running",
      rev: 2,
      createdAt: Date.now(),
      runId: "cccccccccccc",
      result: "",
      files: [],
      pending: [],
    });
    await jobs.recoverJobs();
    const { job } = await settled("bbbbbbbbbbbb");
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/потерян/);
  });

  it("removes only finished jobs", async () => {
    const job = await start("hang");
    await expect(jobs.removeJob(job.id)).rejects.toThrow(/работает/);
    await jobs.stopJob(job.id);
    await settled(job.id);
    await jobs.removeJob(job.id);
    expect(await jobs.readJob(job.id)).toBeNull();
    expect(await jobs.readJob("../etc")).toBeNull();
  });
});
