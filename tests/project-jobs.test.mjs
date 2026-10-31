import { afterEach, expect, test, vi } from "vite-plus/test";
import { effectScope } from "vue";
import { continuationPrompt, useProjectJobs } from "../src/modules/agent/model/project-jobs.ts";
import { shouldContinue } from "../src/modules/agent/model/job-chat.ts";

const job = (extra = {}) => ({
  id: "aaaaaaaaaaaa",
  backend: "codex",
  task: "fix it",
  projectId: "p1",
  cwd: "/work",
  unattended: false,
  status: "running",
  rev: 1,
  createdAt: 1,
  files: [],
  pending: [],
  ...extra,
});

const reply = (body) => ({ ok: true, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

test("the watcher reports status changes and stops with its scope", async () => {
  const changes = [];
  let body = { jobs: [job()] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(body)),
  );
  const scope = effectScope();
  const watcher = scope.run(() =>
    useProjectJobs("p1", (next, before) => changes.push([before?.status, next.status])),
  );
  await watcher.refresh();
  expect(watcher.jobs.value.map((item) => item.status)).toEqual(["running"]);
  body = { jobs: [job({ status: "done", rev: 2, result: "ok" })] };
  await watcher.refresh();
  expect(changes).toEqual([
    [undefined, "running"],
    ["running", "done"],
  ]);
  expect(watcher.jobs.value[0].result).toBe("ok");
  scope.stop();
});

test("a failed poll keeps the last known jobs and reports the reason", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({ error: "нет связи" }) })),
  );
  const scope = effectScope();
  const watcher = scope.run(() => useProjectJobs("p1"));
  await watcher.refresh();
  expect(watcher.error.value).toBe("нет связи");
  expect(watcher.jobs.value).toEqual([]);
  scope.stop();
});

test("only a fresh finished job of this chat continues it once", () => {
  const now = Date.now();
  const running = job({ status: "running", origin: "p1", createdAt: now });
  const done = job({ status: "done", origin: "p1", createdAt: now });
  expect(shouldContinue(done, running, "p1", now)).toBe(true);
  expect(shouldContinue(done, undefined, "p1", now)).toBe(true);
  expect(shouldContinue(done, undefined, "other", now)).toBe(false);
  expect(shouldContinue(job({ status: "done", origin: "p1" }), undefined, "p1", now)).toBe(false);
  expect(shouldContinue(done, done, "p1", now)).toBe(false);
  expect(shouldContinue(job({ status: "stopped", origin: "p1" }), running, "p1", now)).toBe(false);
  expect(shouldContinue(done, undefined, "p1", now + 60_000)).toBe(false);
  // A long job that finished while the tab was away is still fresh by its end time.
  const finished = job({
    status: "done",
    origin: "p1",
    createdAt: now - 20 * 60_000,
    endedAt: now,
  });
  expect(shouldContinue(finished, undefined, "p1", now)).toBe(true);
});

test("the continuation prompt names the job and asks for the diff", () => {
  const text = continuationPrompt(job({ status: "done", worktree: { id: "x", branch: "b" } }));
  expect(text).toContain("aaaaaaaaaaaa");
  expect(text).toContain("ide.agent.job.diff");
  expect(text).toContain("изолированной копии");
  const failed = continuationPrompt(job({ status: "error", error: "boom" }));
  expect(failed).toContain("Ошибка: boom");
  expect(failed).not.toContain("изолированной копии");
});
