import { expect, test } from "vite-plus/test";
import { jobItems } from "../src/modules/agent/model/activity.ts";
import { jobTurn } from "../src/modules/agent/model/job-turn.ts";
import { canContinueInChat } from "../src/modules/agent/model/job-continue.ts";
import { registerBuiltinClientAgents } from "../src/app/agents.ts";

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

test("a page hears about a job that waits for the user or ended, once", async () => {
  const { jobNotices } = await import("../src/modules/agent/lib/job-notify.ts");
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
