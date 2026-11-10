import { afterAll, beforeAll, test, expect } from "vite-plus/test";
import { appendFile, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  clearUsageLogStore,
  closeAnalyticsStore,
  readUsageEvents,
  readUsageSources,
  refreshUsageLogs,
  resetUsageLogScan,
  usageAnalytics,
} from "../packages/server/modules/usage-analytics/index.ts";
import {
  registerUsageLogReader,
  resetUsageLogReaders,
} from "../packages/server/modules/usage-log/index.ts";
import { codexUsageLog } from "../packages/server/modules/agents/codex/index.ts";
import { opencodeUsageLog } from "../packages/server/modules/agents/opencode/index.ts";
import { kimiUsageLog } from "../packages/server/modules/agents/kimi/index.ts";
import { updateProjects } from "../packages/server/modules/projects/index.ts";

const now = Date.now();
const projectPath = "/tmp/projector-usage-logs-project";
let directory;
let previousHome;
let previousData;
let codexFile;

const tokenCount = (ordinal, at, input, cached, output) =>
  JSON.stringify({
    timestamp: new Date(at).toISOString(),
    ordinal,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          cache_write_input_tokens: 0,
          output_tokens: output,
        },
      },
    },
  });

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-usage-logs-"));
  previousHome = process.env.HOME;
  previousData = process.env.XDG_DATA_HOME;
  process.env.HOME = join(directory, "home");
  process.env.XDG_DATA_HOME = join(directory, "data");
  await mkdir(process.env.HOME, { recursive: true });
  registerUsageLogReader(codexUsageLog);
  registerUsageLogReader(opencodeUsageLog);
  registerUsageLogReader(kimiUsageLog);
  await updateProjects((projects) =>
    projects.push({
      id: "p-logs",
      name: "Журналы",
      path: projectPath,
      url: "",
      icon: "",
      mode: "server",
      defaultCommandId: "",
      commands: [],
      createdAt: "",
    }),
  );

  const at = now - 3600000;
  codexFile = join(
    process.env.HOME,
    ".codex",
    "sessions",
    "2026",
    "11",
    "10",
    "rollout-2026-11-10T10-00-00-abc.jsonl",
  );
  await mkdir(join(codexFile, ".."), { recursive: true });
  await writeFile(
    codexFile,
    [
      JSON.stringify({
        timestamp: new Date(at).toISOString(),
        ordinal: 0,
        type: "session_meta",
        payload: { id: "sess-codex", cwd: projectPath },
      }),
      JSON.stringify({
        timestamp: new Date(at).toISOString(),
        ordinal: 1,
        type: "turn_context",
        payload: { model: "gpt-test", cwd: projectPath },
      }),
      tokenCount(3, at, 1000, 400, 50),
      tokenCount(5, at + 1000, 2000, 1600, 80),
    ].join("\n") + "\n",
  );

  const messageDirectory = join(
    process.env.XDG_DATA_HOME,
    "opencode",
    "storage",
    "message",
    "ses_open",
  );
  await mkdir(messageDirectory, { recursive: true });
  await writeFile(
    join(messageDirectory, "msg_a.json"),
    JSON.stringify({
      id: "msg_a",
      sessionID: "ses_open",
      role: "assistant",
      modelID: "deepseek-chat",
      time: { created: at, completed: at + 2000 },
      path: { cwd: projectPath },
      cost: 0.12,
      tokens: { input: 519, output: 68, reasoning: 13, cache: { read: 33414, write: 0 } },
    }),
  );
  await writeFile(
    join(messageDirectory, "msg_user.json"),
    JSON.stringify({ id: "msg_user", sessionID: "ses_open", role: "user", time: { created: at } }),
  );

  // OpenCode 1.x keeps messages in SQLite; the reader must see both storage versions.
  const database = new DatabaseSync(join(process.env.XDG_DATA_HOME, "opencode", "opencode.db"));
  database.exec("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)");
  database
    .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
    .run(
      "msg_db",
      "ses_db",
      at,
      JSON.stringify({
        role: "assistant",
        modelID: "deepseek-flash",
        time: { created: at, completed: at + 3000 },
        path: { cwd: projectPath },
        cost: 0.5,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 50, write: 0 } },
      }),
    );
  database
    .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
    .run("msg_db_user", "ses_db", at, JSON.stringify({ role: "user", time: { created: at } }));
  database.exec("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT)");
  database.exec(
    "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)",
  );
  database
    .prepare("INSERT INTO session_v2 (id, directory) VALUES (?, ?)")
    .run("ses_db_two", projectPath);
  database
    .prepare(
      "INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      "msg_db_two",
      "ses_db_two",
      "assistant",
      at,
      at,
      JSON.stringify({
        role: "assistant",
        model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" },
        time: { created: at, completed: at + 4000 },
        cost: 1.25,
        tokens: { input: 200, output: 20, reasoning: 0, cache: { read: 100, write: 0 } },
      }),
    );
  database.close();

  const sessionDirectory = join(
    process.env.HOME,
    ".kimi-code",
    "sessions",
    "workspace",
    "session_kimi",
  );
  await mkdir(join(sessionDirectory, "agents", "main"), { recursive: true });
  await writeFile(join(sessionDirectory, "state.json"), JSON.stringify({ cwd: projectPath }));
  await writeFile(
    join(sessionDirectory, "agents", "main", "wire.jsonl"),
    [
      JSON.stringify({
        type: "usage.record",
        usageScope: "turn",
        model: "kimi-code/test",
        time: at,
        usage: { inputOther: 100, output: 10, inputCacheRead: 900, inputCacheCreation: 20 },
      }),
      JSON.stringify({
        type: "usage.record",
        usageScope: "session",
        time: at + 1000,
        usage: { inputOther: 999999, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
      }),
      JSON.stringify({
        type: "usage.record",
        usageScope: "turn",
        model: "kimi-code/test",
        time: at + 2000,
        usage: { inputOther: 200, output: 20, inputCacheRead: 1800, inputCacheCreation: 0 },
      }),
    ].join("\n") + "\n",
  );

  resetUsageLogScan();
  await refreshUsageLogs(0, now, true);
});

afterAll(async () => {
  clearUsageLogStore();
  closeAnalyticsStore();
  resetUsageLogReaders();
  resetUsageLogScan();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousData === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousData;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("native journals count Codex, OpenCode and Kimi tokens once", async () => {
  const events = readUsageEvents(0);
  expect(events).toHaveLength(7);
  expect(events.find((event) => event.agent === "codex" && event.event === "3")).toMatchObject({
    session: "sess-codex",
    model: "gpt-test",
    input: 600,
    output: 50,
    cacheRead: 400,
    cacheWrite: 0,
    cost: null,
  });
  expect(
    events.find((event) => event.agent === "opencode" && event.event === "msg_a"),
  ).toMatchObject({
    input: 519,
    output: 68,
    cacheRead: 33414,
    cost: 0.12,
    costSource: "recorded",
  });
  expect(
    events.find((event) => event.agent === "opencode" && event.event === "msg_db"),
  ).toMatchObject({
    session: "ses_db",
    input: 100,
    output: 10,
    cacheRead: 50,
    cost: 0.5,
    costSource: "recorded",
  });
  expect(
    events.find((event) => event.agent === "opencode" && event.event === "msg_db_two"),
  ).toMatchObject({
    session: "ses_db_two",
    model: "deepseek-v4.1-flash",
    cwd: projectPath,
    input: 200,
    output: 20,
    cacheRead: 100,
    cost: 1.25,
    costSource: "recorded",
  });
  expect(events.filter((event) => event.agent === "kimi")).toHaveLength(2);

  const analytics = await usageAnalytics(30, now);
  expect(analytics.totals).toMatchObject({
    tokens: 40661,
    answers: 7,
    cost: 1.87,
    pricedAnswers: 3,
    recordedCost: 1.87,
    computedCost: 0,
  });
  expect(analytics.byAgent.map((item) => [item.key, item.tokens])).toEqual(
    expect.arrayContaining([
      ["codex", 3130],
      ["opencode", 34481],
      ["kimi", 3050],
    ]),
  );
  expect(analytics.byProject).toEqual([expect.objectContaining({ key: "Журналы", tokens: 40661 })]);
  expect(analytics.sources).toHaveLength(3);
  expect(analytics.sources.every((source) => source.status === "ok")).toBe(true);
  expect(analytics.sources.find((source) => source.agent === "opencode")).toMatchObject({
    events: 3,
    recordedEvents: 3,
    unpricedEvents: 0,
  });
});

test("an appended journal line adds one event and a second scan adds nothing", async () => {
  await appendFile(codexFile, tokenCount(7, now - 1800000, 3000, 2900, 30) + "\n");
  // A copy in `archived_sessions` repeats the same session and line ids; it must not double count.
  const archived = join(process.env.HOME, ".codex", "archived_sessions", "copy.jsonl");
  await mkdir(join(archived, ".."), { recursive: true });
  await copyFile(codexFile, archived);
  const database = new DatabaseSync(join(process.env.XDG_DATA_HOME, "opencode", "opencode.db"));
  database
    .prepare(
      "INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      "msg_db_three",
      "ses_db_two",
      "assistant",
      now - 1800000,
      now - 1795000,
      JSON.stringify({
        role: "assistant",
        model: { id: "deepseek-v4.1-flash" },
        time: { created: now - 1800000, completed: now - 1795000 },
        cost: 0.25,
        tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 25, write: 0 } },
      }),
    );
  database.close();
  resetUsageLogScan();
  await refreshUsageLogs(0, now, true);
  expect(readUsageEvents(0)).toHaveLength(9);
  expect(
    readUsageEvents(0).find((event) => event.agent === "codex" && event.event === "7"),
  ).toMatchObject({ session: "sess-codex", model: "gpt-test", cwd: projectPath });
  await refreshUsageLogs(0, now, true);
  expect(readUsageEvents(0)).toHaveLength(9);

  const analytics = await usageAnalytics(30, now);
  expect(analytics.totals.tokens).toBe(43771);
  expect(analytics.totals.answers).toBe(9);
});

test("a broken journal is reported as an error, not as zero tokens", async () => {
  const broken = join(
    process.env.XDG_DATA_HOME,
    "opencode",
    "storage",
    "message",
    "ses_broken",
    "msg_broken.json",
  );
  await mkdir(join(broken, ".."), { recursive: true });
  await writeFile(broken, "{ not json");
  resetUsageLogScan();
  await refreshUsageLogs(0, now, true);

  const sources = readUsageSources();
  expect(sources.find((source) => source.agent === "opencode")).toMatchObject({
    status: "error",
    files: 4,
  });
  expect(sources.find((source) => source.agent === "opencode")?.message).toContain("не прочитан");
  const analytics = await usageAnalytics(30, now);
  // The healthy message still counts; the broken file contributes nothing but is not a zero fact.
  expect(analytics.totals.tokens).toBe(43771);
});
