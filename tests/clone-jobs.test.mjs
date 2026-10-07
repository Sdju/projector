import { expect, test } from "vite-plus/test";
import { setTimeout as sleep } from "node:timers/promises";
import { cancelCloneJob, cloneJob, startCloneJob } from "../server/modules/git-import/index.ts";

const project = { id: "p", name: "app", path: "/tmp/app" };
const settled = async (id) => {
  for (let i = 0; i < 200; i++) {
    const { phase } = cloneJob(id);
    if (["done", "error", "cancelled"].includes(phase)) return cloneJob(id);
    await sleep(5);
  }
  throw new Error("job did not finish");
};

test("a clone job reports phases and finishes with the project", async () => {
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
  expect(job.phase).toBe("queued");
  const done = await settled(job.id);
  expect(done.phase).toBe("done");
  expect(done.project).toStrictEqual(project);
  expect(phases).toStrictEqual([
    "Проверяю Docker и образ",
    "Скачиваю образ Docker",
    "Клонирую репозиторий",
    "Добавляю проект",
  ]);
});

test("cancelling aborts the running step and the job stays cancelled", async () => {
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
  expect(cloneJob(job.id).phase).toBe("cloning");
  cancelCloneJob(job.id);
  const result = await settled(job.id);
  expect(aborted).toBe(true);
  expect(result.phase).toBe("cancelled");
  expect(result.project).toBe(undefined);
});

test("failures keep their reason and unknown ids are rejected", async () => {
  const job = startCloneJob({ repository: "o/r" }, async () => {
    throw new Error("Нет доступа к репозиторию");
  });
  const failed = await settled(job.id);
  expect(failed.phase).toBe("error");
  expect(failed.message).toBe("Нет доступа к репозиторию");
  // Cancelling a finished job changes nothing.
  expect(cancelCloneJob(job.id).phase).toBe("error");
  expect(() => cloneJob("00000000-0000-0000-0000-000000000000")).toThrow(
    expect.objectContaining({ status: 404 }),
  );
});
