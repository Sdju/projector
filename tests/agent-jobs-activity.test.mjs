import { expect, test } from "vite-plus/test";
import { jobItems } from "../packages/client/modules/agent/model/activity.ts";
import { jobTurn } from "../packages/client/modules/agent/model/job-turn.ts";
import { canContinueInChat } from "../packages/client/modules/agent/model/job-continue.ts";
import { jobBarSections } from "../packages/client/modules/agent/lib/job-bar.ts";
import { taskSummaryLine } from "../packages/client/modules/agent/lib/task-detail.ts";
import { registerBuiltinClientAgents } from "../packages/client/app/agents.ts";

registerBuiltinClientAgents();

const job = (id, status, extra = {}) => ({
  id,
  backend: "claude-code",
  task: ` задание ${id} `,
  projectId: "p1",
  status,
  files: [],
  pending: [],
  ...extra,
});

test("the island lists unfinished jobs and marks the ones that wait for the user", () => {
  const items = jobItems([
    job("a", "running"),
    job("b", "needs-user"),
    job("c", "done"),
    job("d", "error"),
    job("e", "stopped"),
    job("f", "queued"),
  ]);
  expect(items.map((item) => item.job.id)).toEqual(["a", "b", "f"]);
  expect(items[0]).toMatchObject({ agent: "Claude Code", topic: "задание a", busy: true });
  expect(items[1]).toMatchObject({ busy: false, needsUser: true, chat: "job:b" });
});

test("the journal of a job reads as one answer of the agent", () => {
  const turn = jobTurn(
    [
      { at: 1, event: "status", data: { status: "running" } },
      { at: 2, event: "text", data: { text: "привет" } },
      { at: 3, event: "tool", data: { id: "t", name: "Write", input: { file_path: "a" } } },
      { at: 4, event: "tool-result", data: { id: "t", name: "Write", output: "ok" } },
      { at: 5, event: "answer", data: { summary: "разрешено" } },
    ],
    "job-x",
    1,
  );
  expect(turn.text.trim()).toBe("привет");
  expect(turn.tools).toMatchObject([{ id: "t", status: "done" }]);
  expect(turn.parts.at(-1)).toEqual({ type: "note", text: "Ответ на запрос: разрешено" });
});

test("only a job in the project itself continues in a chat", () => {
  expect(canContinueInChat(job("a", "done", { sessionId: "s" }))).toBe(true);
  expect(canContinueInChat(job("a", "done"))).toBe(false);
  expect(canContinueInChat(job("a", "done", { sessionId: "s", worktree: { id: "w" } }))).toBe(
    false,
  );
});

test("the dock keeps this chat's finished jobs next to the active ones", () => {
  const own = "projector:p1:chat";
  const sections = jobBarSections(
    [
      job("run", "running", { origin: own, startedAt: 10, createdAt: 10 }),
      job("wait", "needs-user", { startedAt: 10, createdAt: 10 }),
      job("old", "done", { origin: own, endedAt: 50, createdAt: 10 }),
      job("new", "done", { origin: own, endedAt: 90, createdAt: 10 }),
      job("failed", "error", { origin: own, endedAt: 70, createdAt: 10 }),
      job("stopped", "stopped", { origin: own, endedAt: 60, createdAt: 10 }),
      job("other", "done", { origin: "projector:p1:another", endedAt: 100, createdAt: 10 }),
      job("api", "done", { endedAt: 110, createdAt: 10 }),
    ],
    own,
  );
  expect(sections.active.map((item) => item.id)).toEqual(["run", "wait"]);
  expect(sections.recent.map((item) => item.id)).toEqual(["new", "failed", "stopped", "old"]);
  // Without a chat there is no owner: finished work stays out of the dock.
  expect(jobBarSections([job("old", "done", { origin: own })], undefined).recent).toEqual([]);
  expect(jobBarSections([job("old", "done", { origin: own })], own, 1).recent).toHaveLength(1);
});

test("a task summary loses markdown before it reaches the compact row", () => {
  expect(taskSummaryLine("**AgentJob** — это `запись` в job.json")).toBe(
    "AgentJob — это запись в job.json",
  );
  expect(taskSummaryLine("## Итог\n\nСм. [отчёт](https://example.com)")).toBe("Итог См. отчёт");
  expect(taskSummaryLine(undefined)).toBe("");
});

test("a page hears about a job that waits for the user or ended, once", async () => {
  const { jobNotices } = await import("../packages/client/modules/agent/lib/job-notify.ts");
  const known = new Map();
  // The first look only records what is there.
  expect(jobNotices(known, [job("a", "running"), job("old", "done")])).toEqual([]);
  expect(jobNotices(known, [job("a", "running"), job("old", "done")])).toEqual([]);
  const waiting = jobNotices(known, [
    job("a", "needs-user", { pending: [{ id: "r", kind: "permission", title: "Write" }] }),
  ]);
  expect(waiting).toMatchObject([{ id: "a", title: "Claude Code ждёт вашего ответа" }]);
  expect(waiting[0].body).toContain("Write");
  expect(jobNotices(known, [job("a", "needs-user")])).toEqual([]);
  expect(jobNotices(known, [job("a", "error", { error: "boom" })])).toMatchObject([
    { title: expect.stringContaining("ошибкой"), body: "boom" },
  ]);
  // A job that started and ended between two polls is still announced.
  expect(jobNotices(known, [job("b", "running"), job("a", "error")])).toEqual([]);
  expect(jobNotices(known, [job("b", "done")])).toMatchObject([
    { id: "b", title: "Claude Code закончил задание" },
  ]);
});
