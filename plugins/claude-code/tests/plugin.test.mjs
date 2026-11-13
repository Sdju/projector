import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../../packages/core/modules/app-paths/index.ts";
import { listAgentBackends } from "../../../packages/server/modules/agent/index.ts";
import {
  installPlugin,
  pluginsDirectory,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../../../packages/server/modules/plugins/index.ts";
import { registerBuiltinAgents, syncPluginAgents } from "../../../packages/server/app/agents.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const source = join(root, "plugins/claude-code");
const pluginId = "@projector/claude-code-agent";

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

test("the Claude Code plugin installs, trusts, loads its code entry and disappears when disabled", async () => {
  onTestFinished(cleanup);
  // The built entry is gitignored; build it here so the test exercises the real loading path.
  execFileSync("vp", ["build", "--config", "plugins/claude-code/vite.config.ts"], {
    cwd: root,
    stdio: "ignore",
  });

  const installed = await installPlugin(source);
  const plugin = installed.plugins.find((item) => item.id === pluginId);
  expect(plugin).toMatchObject({ enabled: false, trusted: false, code: true });
  expect(plugin.agents.map((agent) => agent.id)).toEqual(["claude-code"]);

  await expect(setPluginEnabled(pluginId, true)).rejects.toThrow(/доверие/);
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);

  registerBuiltinAgents();
  await syncPluginAgents();

  const backend = listAgentBackends().find((item) => item.id === "claude-code");
  expect(backend).toMatchObject({
    id: "claude-code",
    label: "Claude Code",
    caption: "Запустит агента Anthropic",
    program: "claude",
    terminal: { program: "claude", executable: "claude", title: "Claude Code" },
    plan: { tools: ["TodoWrite"] },
    usageUrl: "/api/agent/usage/claude-code",
    capabilities: { hosted: true, inject: true, branchSession: true },
  });
  expect(backend.iconSvg).toMatch(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(backend.iconSvg).toMatch(/viewBox="0 0 24 24"/);
  expect(backend.usageWindows?.map((window) => window.name)).toEqual(["weekly", "rolling"]);

  await setPluginEnabled(pluginId, false);
  expect(listAgentBackends().some((item) => item.id === "claude-code")).toBe(false);
});
