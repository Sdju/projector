import { expect, test } from "vite-plus/test";
import {
  inboxGroups,
  inboxHref,
  inboxJobItem,
  inboxNotices,
  inboxRecentRunItem,
  inboxRunItem,
  inboxSourcesFromDevices,
  jobCategory,
  mergeRunItems,
} from "../modules/agent/modules/jobs/model/inbox.ts";
import {
  isItemAttention,
  isItemUnread,
  markInboxItemRead,
  markOldFinishedAsRead,
} from "../modules/agent/modules/jobs/model/inbox-read.ts";
import { registerBuiltinClientAgents } from "../app/agents.ts";

registerBuiltinClientAgents();

const job = (id, status, extra = {}) => ({
  id,
  backend: "codex",
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
    { key: "desk|job|wait", title: "Codex ждёт вашего ответа" },
  ]);
  const error = inboxJobItem(source("desk", "Desktop"), job("wait", "error", { error: "boom" }), [
    project,
  ]);
  expect(inboxNotices(known, [error], false)).toMatchObject([
    { title: "Codex: задание завершилось ошибкой", body: "boom" },
  ]);
});

test("live runs with judge/question/secret requests and finished runs produce inbox items and notices", () => {
  const src = source("", "Это устройство", true);
  const liveJudged = inboxRunItem(
    src,
    {
      id: "r1",
      backend: "kimi",
      projectId: "p1",
      chat: "kimi:p1:chat",
      topic: "удалить старое",
      status: "needs-user",
      pending: [
        {
          id: "perm1",
          kind: "permission",
          title: "rm -rf dist",
          tool: "bash",
          judge: {
            score: 4,
            label: "высокий",
            reason: "Удаление каталога",
            confidence: "high",
          },
        },
      ],
    },
    [project],
  );
  expect(liveJudged).toMatchObject({ status: "needs-user", category: "attention" });

  const known = new Map();
  expect(inboxNotices(known, [liveJudged], false)).toMatchObject([
    {
      title: "Kimi ждёт вашего ответа",
      body: "Судья 4/5 (высокий) — Удаление каталога: rm -rf dist",
    },
  ]);

  const runningRun = inboxRunItem(
    src,
    {
      id: "r2",
      backend: "kimi",
      projectId: "p1",
      chat: "kimi:p1:chat2",
      topic: "проверить тесты",
    },
    [project],
  );
  expect(inboxNotices(known, [runningRun], false)).toEqual([]);

  const finishedRun = inboxRecentRunItem(
    src,
    {
      id: "r2",
      backend: "kimi",
      projectId: "p1",
      chat: "kimi:p1:chat2",
      topic: "проверить тесты",
      status: "done",
      resultPreview: "Все 12 тестов прошли",
      startedAt: 10,
      endedAt: Date.now(),
    },
    [project],
  );
  expect(finishedRun.category).toBe("finished");
  expect(inboxNotices(known, [finishedRun], false)).toMatchObject([
    {
      title: "Kimi закончил работу",
      body: "Все 12 тестов прошли",
    },
  ]);

  const formRun = inboxRecentRunItem(
    src,
    {
      id: "r3",
      backend: "projector",
      projectId: "p1",
      chat: "p1",
      topic: "настроить порт",
      status: "done",
      awaitingReply: true,
      startedAt: 10,
      endedAt: Date.now(),
    },
    [project],
  );
  expect(formRun).toMatchObject({
    status: "needs-user",
    category: "attention",
    awaitingReply: true,
  });
  expect(inboxNotices(known, [formRun], false)).toMatchObject([
    {
      title: "Projector ждёт вашего ответа",
      body: "Форма ответа: настроить порт",
    },
  ]);

  const merged = mergeRunItems(
    src,
    [
      {
        id: "r-live",
        backend: "kimi",
        projectId: "p1",
        chat: "kimi:p1:chat",
        topic: "в работе",
      },
    ],
    [
      {
        id: "r-old-same-chat",
        backend: "kimi",
        projectId: "p1",
        chat: "kimi:p1:chat",
        topic: "старый",
        status: "done",
        startedAt: 1,
        endedAt: Date.now(),
      },
      {
        id: "r-other-done",
        backend: "kimi",
        projectId: "p1",
        chat: "kimi:p1:done",
        topic: "готовый",
        status: "done",
        startedAt: 1,
        endedAt: Date.now(),
      },
    ],
    [project],
  );
  expect(merged.map((item) => item.id)).toEqual(["r-live", "r-other-done"]);
});

test("a finished answer is announced as prose, not as widget markup", () => {
  const src = source("", "Это устройство", true);
  const answer = `<Card title="Причина" hint="кадр больше лимита">
<Bars unit=" КБ" :items="[{label:'828a', value:300}]" />
</Card>

Кадр больше лимита, поэтому туннель рвёт соединение.`;
  const item = inboxRecentRunItem(
    src,
    {
      id: "r-markup",
      backend: "opencode",
      projectId: "p1",
      chat: "p1:chat",
      topic: "разобраться с пушами",
      status: "done",
      resultPreview: answer,
      startedAt: 10,
      endedAt: Date.now(),
    },
    [project],
  );
  expect(item.resultPreview).toBe("Кадр больше лимита, поэтому туннель рвёт соединение.");
  // The running state was seen before, so the finished state is a new notice.
  const known = new Map([["|run|r-markup", "running|"]]);
  expect(inboxNotices(known, [item], false)).toMatchObject([
    {
      title: "OpenCode закончил работу",
      body: "Кадр больше лимита, поэтому туннель рвёт соединение.",
    },
  ]);
});

test("fresh completions stay unread until acknowledged, while stale ones are auto-read", () => {
  const src = source("", "Это устройство", true);
  const now = Date.now();
  const fresh = inboxRecentRunItem(
    src,
    {
      id: "fresh",
      backend: "kimi",
      projectId: "p1",
      chat: "kimi:p1:fresh",
      topic: "свежая",
      status: "done",
      startedAt: now - 5000,
      endedAt: now - 1000,
    },
    [project],
  );
  const stale = inboxRecentRunItem(
    src,
    {
      id: "stale",
      backend: "kimi",
      projectId: "p1",
      chat: "kimi:p1:stale",
      topic: "давняя",
      status: "done",
      startedAt: now - 3_600_000,
      endedAt: now - 3_500_000,
    },
    [project],
  );
  const formItem = inboxRecentRunItem(
    src,
    {
      id: "form",
      backend: "projector",
      projectId: "p1",
      chat: "p1",
      topic: "форма",
      status: "done",
      awaitingReply: true,
      startedAt: now - 2000,
      endedAt: now - 1000,
    },
    [project],
  );
  markOldFinishedAsRead([fresh, stale, formItem], now);
  expect(isItemUnread(fresh)).toBe(true);
  expect(isItemUnread(stale)).toBe(false);
  expect(isItemAttention(formItem)).toBe(true);

  markInboxItemRead(fresh);
  markInboxItemRead(formItem);
  expect(isItemUnread(fresh)).toBe(false);
  expect(isItemAttention(formItem)).toBe(false);
});
