import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  cancelCloneJob,
  cloneJob,
  startCloneJob,
} from "../server/modules/git-import/index.ts";

const project = { id: "p", name: "app", path: "/tmp/app" };
const settled = async (id) => {
  for (let i = 0; i < 200; i++) {
    const { phase } = cloneJob(id);
    if (["done", "error", "cancelled"].includes(phase)) return cloneJob(id);
    await sleep(5);
  }
  throw new Error("job did not finish");
};

await test("a clone job reports phases and finishes with the project", async () => {
  const phases = [];
  const job = startCloneJob({ repository: "o/r" }, async (_body, hooks) => {
    await sleep(1);
    for (const phase of ["preparing", "pulling", "cloning", "finishing"]) {
      hooks.phase(phase);
      phases.push(cloneJob(job.id).message);
      await sleep(1);
    }
    return { project };
  });
  assert.equal(job.phase, "queued");
  const done = await settled(job.id);
  assert.equal(done.phase, "done");
  assert.deepEqual(done.project, project);
  assert.deepEqual(phases, [
    "Проверяю Docker и образ",
    "Скачиваю образ Docker",
    "Клонирую репозиторий",
    "Добавляю проект",
  ]);
});

await test("cancelling aborts the running step and the job stays cancelled", async () => {
  let aborted = false;
  const job = startCloneJob({ repository: "o/r" }, (_body, hooks) => {
    hooks.phase("cloning");
    return new Promise((_resolve, reject) => {
      hooks.signal.addEventListener("abort", () => {
        aborted = true;
        // A step finishing after the abort must not turn the job back into "cloning".
        hooks.phase("finishing");
        reject(new Error("aborted"));
      });
    });
  });
  await sleep(5);
  assert.equal(cloneJob(job.id).phase, "cloning");
  cancelCloneJob(job.id);
  const result = await settled(job.id);
  assert.equal(aborted, true);
  assert.equal(result.phase, "cancelled");
  assert.equal(result.project, undefined);
});

await test("failures keep their reason and unknown ids are rejected", async () => {
  const job = startCloneJob({ repository: "o/r" }, async () => {
    throw new Error("Нет доступа к репозиторию");
  });
  const failed = await settled(job.id);
  assert.equal(failed.phase, "error");
  assert.equal(failed.message, "Нет доступа к репозиторию");
  // Cancelling a finished job changes nothing.
  assert.equal(cancelCloneJob(job.id).phase, "error");
  assert.throws(() => cloneJob("00000000-0000-0000-0000-000000000000"), { status: 404 });
});
