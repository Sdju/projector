// One answer of a trusted agent plugin, held by its own process so that a server restart or a hot
// reload leaves it going. The server passes the package entry, its content hash and the agent id in
// the environment; this process loads the same plugin and runs its direct answer (`options.run` is
// absent, so the backend does not host itself again).
//
// Usage: node plugin-runner.ts <run directory>
import type { AgentBackend } from "../modules/agent/index.ts";
import { registerAgentBackend, runHostedRunner } from "../modules/agent/index.ts";
import { loadCodeAgents } from "../modules/agents/plugin/index.ts";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";

/**
 * Loads the plugin's backends and composes the catalogs this process needs: the feature prompt of
 * the answer reads the same toggles as the server, so the plugin backends are registered first.
 */
export async function loadPluginAnswer(
  entry: string,
  hash: string | undefined,
  agentId: string,
): Promise<AgentBackend> {
  const backends = await loadCodeAgents(entry, hash);
  for (const backend of backends) registerAgentBackend(backend);
  registerBuiltinWidgetDefinitions();
  registerBuiltinAgentFeatures();
  const backend = backends.find((item) => item.id === agentId);
  if (!backend) throw new Error(`Плагин не вернул агента ${agentId}`);
  return backend;
}

async function main(): Promise<void> {
  const entry = process.env.PROJECTOR_PLUGIN_ENTRY;
  const agentId = process.env.PROJECTOR_PLUGIN_AGENT;
  if (!entry || !agentId) throw new Error("Не задан плагин или агент для запуска");
  const hash = process.env.PROJECTOR_PLUGIN_HASH || undefined;
  const backend = await loadPluginAnswer(entry, hash, agentId);
  runHostedRunner((options) => backend.run(options));
}

// A test imports this module to check the registration without starting an answer; a real host
// passes the run directory as the first argument.
if (process.argv[2]) void main();
