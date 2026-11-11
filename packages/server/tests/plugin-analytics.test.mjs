import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { listAgentBackends } from "../modules/agent/index.ts";
import {
  installPlugin,
  pluginsDirectory,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../modules/plugins/index.ts";
import {
  clearUsageLogStore,
  closeAnalyticsStore,
  readUsageEvents,
  readUsageSources,
  refreshUsageLogs,
  resetUsageLogScan,
} from "../modules/usage-analytics/index.ts";
import { resetUsageLogReaders, usageLogReaders } from "../modules/usage-log/index.ts";
import { ensureAgentsReady, registerBuiltinAgents, syncPluginAgents } from "../app/agents.ts";

const fixture = fileURLToPath(new URL("fixtures/analytics-plugin", import.meta.url));
const pluginId = "@projector-tests/analytics-plugin";
const agentId = "fixture-analytics";
let directory;
let previous = {};

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
  directory = await mkdtemp(join(tmpdir(), "projector-plugin-analytics-"));
  previous = {
    PROJECTOR_FIXTURE_ANALYTICS_ROOT: process.env.PROJECTOR_FIXTURE_ANALYTICS_ROOT,
    PROJECTOR_FIXTURE_ANALYTICS_FILE: process.env.PROJECTOR_FIXTURE_ANALYTICS_FILE,
    PROJECTOR_FIXTURE_ANALYTICS_AT: process.env.PROJECTOR_FIXTURE_ANALYTICS_AT,
    PROJECTOR_FIXTURE_ANALYTICS_CWD: process.env.PROJECTOR_FIXTURE_ANALYTICS_CWD,
  };
});

afterEach(async () => {
  await setPluginEnabled(pluginId, false).catch(() => undefined);
  await removePlugin(pluginId).catch(() => undefined);
  resetUsageLogReaders();
  resetUsageLogScan();
  clearUsageLogStore();
  closeAnalyticsStore();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a trusted plugin brings its native journal into analytics and takes it away on disable", async () => {
  const now = Date.now();
  const journal = join(directory, "journal.jsonl");
  await writeFile(journal, "{}\n");
  process.env.PROJECTOR_FIXTURE_ANALYTICS_ROOT = directory;
  process.env.PROJECTOR_FIXTURE_ANALYTICS_FILE = journal;
  process.env.PROJECTOR_FIXTURE_ANALYTICS_AT = String(now);
  process.env.PROJECTOR_FIXTURE_ANALYTICS_CWD = "/tmp/projector-plugin-analytics-project";

  await installPlugin(fixture);
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);

  registerBuiltinAgents();
  await ensureAgentsReady();
  await syncPluginAgents();

  expect(listAgentBackends().some((backend) => backend.id === agentId)).toBe(true);
  expect(usageLogReaders().map((reader) => reader.agent)).toEqual(
    expect.arrayContaining(["codex", "opencode", "kimi", agentId]),
  );

  await refreshUsageLogs(now - 86400000, now, true);
  expect(readUsageEvents(now - 86400000).find((event) => event.agent === agentId)).toMatchObject({
    session: "fixture-session",
    event: "fixture-event",
    model: "fixture-model",
    input: 100,
    output: 20,
    cacheRead: 30,
    cacheWrite: 5,
    costSource: "none",
  });
  expect(readUsageSources().find((source) => source.agent === agentId)).toMatchObject({
    label: "Fixture token journal",
    status: "ok",
    files: 1,
  });

  await setPluginEnabled(pluginId, false);
  expect(usageLogReaders().some((reader) => reader.agent === agentId)).toBe(false);
});
