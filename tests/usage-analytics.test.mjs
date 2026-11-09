import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveLiveChat,
  closeHistoryStore,
  writeAgentHistory,
} from "../packages/server/modules/agent/index.ts";
import {
  closeAnalyticsStore,
  readLimitSamples,
  readLimitSeries,
  readProviderSamples,
  readProviderSpend,
  recordAgentLimits,
  recordProviderBalance,
  usageAnalytics,
} from "../packages/server/modules/usage-analytics/index.ts";
import {
  closeSpendStore,
  recordTaskSpend,
  taskSpend,
} from "../packages/server/modules/spend/index.ts";
import { updateProjects } from "../packages/server/modules/projects/index.ts";

const usage = (input, output, cacheRead, cost) => ({
  input,
  output,
  cacheRead,
  cacheWrite: 0,
  ...(cost !== undefined ? { cost } : {}),
});
let directory;
let previous;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-analytics-"));
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
});
afterAll(async () => {
  closeHistoryStore();
  closeAnalyticsStore();
  closeSpendStore();
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("chat analytics counts live and archived answers by agent, model and project", async () => {
  const now = new Date(2026, 10, 9, 12, 0, 0).getTime();
  const at = now - 2 * 3600000;
  const answer = (id, options) => ({
    id,
    role: "assistant",
    text: "ответ",
    tools: [],
    at,
    usage: usage(options.input, options.output, options.cacheRead, options.cost),
    context: { used: 100, size: 1000, model: options.model },
  });

  await writeAgentHistory(
    "project-one",
    [
      { id: "u1", role: "user", text: "первый", tools: [], at },
      answer("a1", { input: 100, output: 50, cacheRead: 850, model: "deepseek-flash" }),
    ],
    { project: "project-one", backend: "codex", title: "первый" },
  );
  const archived = await archiveLiveChat("project-one");
  expect(archived).toBeTruthy();

  await writeAgentHistory(
    "project-two",
    [
      { id: "u2", role: "user", text: "второй", tools: [], at: at + 1000 },
      answer("a2", {
        input: 10,
        output: 20,
        cacheRead: 70,
        model: "claude-sonnet",
        cost: 0.25,
      }),
    ],
    { project: "project-two", backend: "claude-code", title: "второй" },
  );
  await updateProjects((projects) =>
    projects.push({
      id: "project-two",
      name: "Проект два",
      path: "/tmp/project-two",
      url: "",
      icon: "",
      mode: "server",
      defaultCommandId: "",
      commands: [],
      createdAt: "",
    }),
  );

  const result = await usageAnalytics(7, now);
  expect(result.totals).toMatchObject({
    input: 110,
    output: 70,
    cacheRead: 920,
    cacheWrite: 0,
    tokens: 1100,
    answers: 2,
    cost: 0.25,
    pricedAnswers: 1,
  });
  expect(result.daily).toHaveLength(7);
  expect(result.daily.at(-1)).toMatchObject({ tokens: 1100, answers: 2 });
  expect(result.byAgent.map((item) => [item.key, item.tokens])).toEqual(
    expect.arrayContaining([
      ["codex", 1000],
      ["claude-code", 100],
    ]),
  );
  expect(result.byModel.map((item) => item.key)).toEqual(
    expect.arrayContaining(["deepseek-flash", "claude-sonnet"]),
  );
  expect(result.byProject.map((item) => item.key)).toEqual(
    expect.arrayContaining(["другой проект", "Проект два"]),
  );
});

test("limit samples dedupe a cached answer and build a paced series", () => {
  const now = new Date(2026, 10, 9, 13, 0, 0).getTime();
  const checkedAt = now - 3600000;
  const resetsAt = Math.floor(now / 1000) + 2 * 3600;
  const answer = (at, used) => ({
    status: "ready",
    checkedAt: at,
    weekly: { usedPercent: used, resetsAt, limited: false },
  });

  recordAgentLimits("codex", answer(checkedAt, 40));
  recordAgentLimits("codex", answer(checkedAt, 40));
  expect(readLimitSamples(0)).toHaveLength(1);

  recordAgentLimits("codex", answer(checkedAt + 10 * 60000, 55));
  expect(readLimitSamples(0)).toHaveLength(2);

  const [series] = readLimitSeries(0, now);
  expect(series).toMatchObject({
    agent: "codex",
    window: "weekly",
    usedPercent: 55,
    resetsAt,
    periodSeconds: 7 * 86400,
    limited: false,
  });
  expect(series.points).toHaveLength(2);
  expect(series.ratePerHour).toBeCloseTo(90);
  expect(series.projectedPercent).toBeGreaterThan(100);
});

test("provider balance samples turn money drops into spend and ignore top-ups", () => {
  const now = new Date(2026, 10, 9, 14, 0, 0).getTime();
  const at = now - 3 * 3600000;
  const answer = (time, total) => ({
    status: "ready",
    providerId: "deepseek",
    providerName: "deepseek",
    checkedAt: time,
    entries: [{ currency: "USD", total, granted: "0.00", toppedUp: "5.00" }],
  });

  recordProviderBalance(answer(at, "5.00"));
  recordProviderBalance(answer(at, "5.00"));
  expect(readProviderSamples(0)).toHaveLength(1);
  recordProviderBalance(answer(at + 60000, "4.50"));
  recordProviderBalance(answer(at + 120000, "5.50"));
  recordProviderBalance(answer(at + 180000, "5.00"));
  expect(readProviderSamples(0)).toHaveLength(4);

  const [entry] = readProviderSpend(0);
  expect(entry).toMatchObject({
    provider: "deepseek",
    label: "deepseek",
    currency: "USD",
    total: 5,
    spent: 1,
    toppedUp: 1,
  });
  expect(entry.points).toHaveLength(4);
});

test("service calls combine into task shares and appear in the analytics answer", async () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 50,
    inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
  const price = { input: 2, output: 8 };
  recordTaskSpend("lens", usage, price, { provider: "deepseek", model: "deepseek-flash" });
  recordTaskSpend("lens", usage, price, { provider: "deepseek", model: "deepseek-flash" });
  recordTaskSpend("judge", usage, price, { provider: "deepseek", model: "deepseek-flash" });

  const spend = taskSpend(0);
  expect(spend.calls).toBe(3);
  expect(spend.byTask.map((item) => [item.key, item.answers, item.tokens])).toEqual(
    expect.arrayContaining([
      ["lens", 2, 300],
      ["judge", 1, 150],
    ]),
  );

  const result = await usageAnalytics(7, Date.now());
  expect(result.serviceCalls).toBe(3);
  expect(result.byTask.find((item) => item.key === "lens")).toMatchObject({
    tokens: 300,
    cost: 0.0012,
  });
});
