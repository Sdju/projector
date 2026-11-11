import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { listAgentBackends } from "../modules/agent/index.ts";
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
  });
  const program = acpProgram("cursor");
  expect(program.dialect).toBeTypeOf("function");
  expect(Object.keys(program.extensions ?? {}).sort()).toEqual([
    "cursor/ask_question",
    "cursor/create_plan",
    "cursor/generate_image",
    "cursor/task",
    "cursor/update_todos",
  ]);

  await setPluginEnabled(pluginId, false);
  expect(listAgentBackends().some((item) => item.id === "cursor")).toBe(false);
});
