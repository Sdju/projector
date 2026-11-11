import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { listAgentBackends } from "../modules/agent/index.ts";
import { readAgentUsageLimits, resetAgentUsageCache } from "../modules/agent-usage/index.ts";
import { acpProgram } from "../modules/agents/acp/acp-programs.ts";
import {
  installPlugin,
  pluginsDirectory,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../modules/plugins/index.ts";
import { registerBuiltinAgents, syncPluginAgents } from "../app/agents.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const source = join(root, "plugins/cursor");
const pluginId = "@projector/cursor-agent";

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

async function cleanup() {
  try {
    await removePlugin(pluginId);
  } catch {
    /* The package may already be gone. */
  }
}

test("the Cursor plugin installs, trusts, loads its code entry and disappears when disabled", async () => {
  onTestFinished(cleanup);
  // The built entry is gitignored; build it here so the test exercises the real loading path.
  execFileSync("vp", ["build", "--config", "plugins/cursor/vite.config.ts"], {
    cwd: root,
    stdio: "ignore",
  });

  const installed = await installPlugin(source);
  const plugin = installed.plugins.find((item) => item.id === pluginId);
  expect(plugin).toMatchObject({ enabled: false, trusted: false, code: true });
  expect(plugin.agents.map((agent) => agent.id)).toEqual(["cursor"]);

  await expect(setPluginEnabled(pluginId, true)).rejects.toThrow(/доверие/);
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);

  registerBuiltinAgents();
  await syncPluginAgents();

  const backend = listAgentBackends().find((item) => item.id === "cursor");
  expect(backend).toMatchObject({
    id: "cursor",
    label: "Cursor",
    caption: "Запустит агента Cursor",
    program: "cursor",
    usageUrl: "/api/agent/usage/cursor",
  });
  expect(backend.usageWindows?.map((window) => window.name)).toEqual(["total", "auto", "api"]);
  const program = acpProgram("cursor");
  expect(program.dialect).toBeTypeOf("function");
  expect(Object.keys(program.extensions ?? {}).sort()).toEqual([
    "cursor/ask_question",
    "cursor/create_plan",
    "cursor/generate_image",
    "cursor/task",
    "cursor/update_todos",
  ]);

  // The installed entry really answers limits: auth comes from disk, the request is bounded.
  const directory = await mkdtemp(join(tmpdir(), "projector-cursor-plugin-"));
  const previousFetch = globalThis.fetch;
  const previous = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    CURSOR_AUTH_CONTENT: process.env.CURSOR_AUTH_CONTENT,
  };
  try {
    process.env.XDG_CONFIG_HOME = directory;
    delete process.env.CURSOR_AUTH_CONTENT;
    await mkdir(join(directory, "cursor"));
    await writeFile(
      join(directory, "cursor", "auth.json"),
      JSON.stringify({ accessToken: "plugin-fixture", refreshToken: "r" }),
    );
    globalThis.fetch = async (url) =>
      url === "https://ipwho.is/"
        ? Response.json({ success: true, is_eu: true })
        : Response.json({
            billingCycleEnd: "1792862002000",
            planUsage: { totalPercentUsed: 15.5, autoPercentUsed: 12.4, apiPercentUsed: 45.5 },
          });
    resetAgentUsageCache();
    expect(await readAgentUsageLimits("cursor")).toMatchObject({
      status: "ready",
      windows: {
        total: { usedPercent: 15.5, resetsAt: 1792862002 },
        auto: { usedPercent: 12.4 },
        api: { usedPercent: 45.5 },
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    resetAgentUsageCache();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }

  await setPluginEnabled(pluginId, false);
  expect(listAgentBackends().some((item) => item.id === "cursor")).toBe(false);
  expect(await readAgentUsageLimits("cursor")).toMatchObject({
    status: "unavailable",
    windows: null,
    message: "Агент не сообщает лимиты",
  });
});
