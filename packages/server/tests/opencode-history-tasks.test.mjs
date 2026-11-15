import { expect, test } from "vite-plus/test";
import { settleOpenCodeHistoryTasks } from "../modules/agents/opencode/history-tasks.ts";

test("settleOpenCodeHistoryTasks closes finished children and drops a stale run", () => {
  const turns = [
    {
      id: "a",
      run: "run-1",
      tasks: [
        {
          id: "t1",
          kind: "agent",
          title: "One",
          status: "running",
          background: true,
          session: "ses_done",
        },
        {
          id: "t2",
          kind: "agent",
          title: "Two",
          status: "running",
          background: true,
          session: "ses_dead",
        },
      ],
    },
  ];
  const outcomes = new Map([
    ["ses_done", "done"],
    ["ses_dead", "stopped"],
  ]);
  expect(settleOpenCodeHistoryTasks(turns, 100, () => outcomes)).toBe(true);
  expect(turns[0].tasks.map((task) => task.status)).toEqual(["done", "stopped"]);
  expect(turns[0].tasks[0].endedAt).toBe(100);
  expect(turns[0].run).toBeUndefined();
});

test("settleOpenCodeHistoryTasks keeps the run while a child has no idle outcome", () => {
  const turns = [
    {
      id: "a",
      run: "run-1",
      tasks: [
        {
          id: "t1",
          kind: "agent",
          title: "Done",
          status: "running",
          background: true,
          session: "ses_done",
        },
        {
          id: "t2",
          kind: "agent",
          title: "Live",
          status: "running",
          background: true,
          session: "ses_live",
        },
      ],
    },
  ];
  expect(settleOpenCodeHistoryTasks(turns, 1, () => new Map([["ses_done", "done"]]))).toBe(true);
  expect(turns[0].tasks.map((task) => task.status)).toEqual(["done", "running"]);
  expect(turns[0].run).toBe("run-1");
});
