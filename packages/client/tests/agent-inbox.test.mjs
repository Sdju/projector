import { expect, test } from "vite-plus/test";
import {
  inboxGroups,
  inboxHref,
  inboxJobItem,
  inboxNotices,
  inboxRunItem,
  inboxSourcesFromDevices,
  jobCategory,
} from "../modules/agent/modules/jobs/model/inbox.ts";
import { registerBuiltinClientAgents } from "../app/agents.ts";

registerBuiltinClientAgents();

const job = (id, status, extra = {}) => ({
  id,
  backend: "claude-code",
  task: ` задание ${id} `,
  projectId: "p1",
  status,
  files: [],
  pending: [],
  createdAt: 1,
  ...extra,
});
const source = (id, name, current = false) => ({
  id,
  name,
  base: current ? "" : `/api/devices/${id}`,
  current,
});
const project = { id: "p1", name: "Projector", path: "/work/projector" };

test("online Hub devices become sources and the current one keeps this page's API", () => {
  const sources = inboxSourcesFromDevices(
    [
      { id: "desk", name: "Desktop", protocol: 1, online: true },
      { id: "laptop", name: "Laptop", protocol: 1, online: true },
      { id: "old", name: "Old", protocol: 1, online: false },
    ],
    "desk",
  );
  expect(sources).toEqual([
    { id: "desk", name: "Desktop", base: "/api/devices/desk", current: true },
    { id: "laptop", name: "Laptop", base: "/api/devices/laptop", current: false },
  ]);
  expect(inboxSourcesFromDevices([], "desk")).toEqual([
    { id: "desk", name: "Это устройство", base: "", current: true },
  ]);
});

test("attention, work and finished stay apart, and groups keep the project order", () => {
  const jobs = [
    inboxJobItem(source("desk", "Desktop"), job("run", "running", { startedAt: 3 }), [project]),
    inboxJobItem(
      source("desk", "Desktop"),
      job("wait", "needs-user", {
        startedAt: 2,
        pending: [{ id: "r", kind: "permission", title: "Write" }],
      }),
      [project],
    ),
    inboxJobItem(source("laptop", "Laptop"), job("gone", "done", { projectId: "p2", endedAt: 4 }), [
      { id: "p2", name: "Another", path: "/work/another" },
    ]),
  ];
  expect(jobCategory(jobs[1])).toBe("attention");
  const groups = inboxGroups(jobs);
  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({
    sourceName: "Desktop",
    projectName: "Projector",
    attention: 1,
    working: 1,
    finished: 0,
  });
  expect(groups[0].items.map((item) => item.id)).toEqual(["wait", "run"]);
  expect(groups[1].items.map((item) => item.id)).toEqual(["gone"]);
});

test("runs of any device open where their chat lives", () => {
  const local = inboxRunItem(
    source("", "Это устройство", true),
    {
      id: "abc",
      backend: "kimi",
      projectId: "p1",
      chat: "kimi:p1:chat",
      topic: "починить",
    },
    [project],
  );
  const remote = {
    ...local,
    sourceId: "laptop",
    sourceName: "Laptop",
    sourceBase: "/api/devices/laptop",
  };
  const sources = [source("", "Это устройство", true), source("laptop", "Laptop")];
  expect(inboxHref(local, sources)).toBe("/projects/work/projector?chat=kimi%3Ap1%3Achat");
  expect(inboxHref(remote, sources)).toBe(
    "/devices/laptop/projects/work/projector?chat=kimi%3Ap1%3Achat",
  );
});

test("a notice about a request is sent once, even after the page is hidden and shown", () => {
  const known = new Map();
  const item = inboxJobItem(
    source("desk", "Desktop"),
    job("wait", "needs-user", {
      pending: [{ id: "r", kind: "question", title: "Куда писать?" }],
    }),
    [project],
  );
  // The first look only records what is already there.
  expect(inboxNotices(known, [item], true)).toEqual([]);
  expect(inboxNotices(known, [item], false)).toEqual([]);
  const next = inboxJobItem(
    source("desk", "Desktop"),
    job("wait", "needs-user", {
      pending: [{ id: "r2", kind: "question", title: "Второй вопрос" }],
    }),
    [project],
  );
  expect(inboxNotices(known, [next], false)).toMatchObject([
    { key: "desk|job|wait", title: "Claude Code ждёт вашего ответа" },
  ]);
  const error = inboxJobItem(source("desk", "Desktop"), job("wait", "error", { error: "boom" }), [
    project,
  ]);
  expect(inboxNotices(known, [error], false)).toMatchObject([
    { title: "Claude Code: задание завершилось ошибкой", body: "boom" },
  ]);
});
