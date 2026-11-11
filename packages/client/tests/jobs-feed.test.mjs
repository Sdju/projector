import { afterEach, expect, test, vi } from "vite-plus/test";
import { effectScope } from "vue";
import { useJobsFeed } from "../modules/agent/modules/jobs/model/jobs-feed.ts";

const job = (id, extra = {}) => ({
  id,
  backend: "codex",
  task: id,
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

afterEach(() => vi.unstubAllGlobals());

test("a pushed change reads both lists once and reaches every subscriber", async () => {
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  let jobs = [job("aaaaaaaaaaaa")];
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      calls++;
      const body = String(url).includes("/runs") ? { runs: [] } : { jobs };
      return { ok: true, json: async () => body };
    }),
  );

  const first = effectScope();
  const second = effectScope();
  const feed = first.run(() => useJobsFeed());
  const other = second.run(() => useJobsFeed());
  await vi.waitFor(() => expect(feed.jobs.value).toHaveLength(1));
  expect(other.jobs.value).toHaveLength(1);

  const before = calls;
  jobs = [...jobs, job("bbbbbbbbbbbb", { projectId: "p2" })];
  page.dispatchEvent(new CustomEvent("projector:jobs-changed"));
  await vi.waitFor(() => expect(feed.jobs.value).toHaveLength(2));
  expect(other.jobs.value).toHaveLength(2);
  // One read of two endpoints for the page, not one poll per subscriber.
  expect(calls - before).toBe(2);

  first.stop();
  second.stop();
  expect(feed.jobs.value).toEqual([]);
});
