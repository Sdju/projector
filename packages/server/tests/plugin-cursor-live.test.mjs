import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { acpControls } from "../modules/agents/acp/acp-tools.ts";
import {
  installPlugin,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../modules/plugins/index.ts";
import { registerBuiltinAgents, syncPluginAgents } from "../app/agents.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const pluginId = "@projector/cursor-agent";

test("real cursor acp handshake", { skip: process.env.PROJECTOR_TEST_CURSOR !== "1" }, async () => {
  execFileSync("vp", ["build", "--config", "plugins/cursor/vite.config.ts"], {
    cwd: root,
    stdio: "ignore",
  });
  await installPlugin(join(root, "plugins/cursor"));
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);
  registerBuiltinAgents();
  await syncPluginAgents();
  const cwd = await mkdtemp(join(tmpdir(), "projector-cursor-live-"));
  try {
    const controls = await acpControls("cursor", cwd);
    expect(Array.isArray(controls)).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await setPluginEnabled(pluginId, false);
    await removePlugin(pluginId);
  }
});
