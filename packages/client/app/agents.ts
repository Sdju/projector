import { registerClientAgent } from "../modules/agents-integration/catalog/index.ts";
import { claudeAgent } from "../modules/agents-integration/claude/index.ts";
import { codexAgent } from "../modules/agents-integration/codex/index.ts";
import { opencodeAgent } from "../modules/agents-integration/opencode/index.ts";
import { kimiAgent } from "../modules/agents-integration/kimi/index.ts";
import { projectorAgent } from "../modules/agents-integration/projector/index.ts";

/**
 * The agents the client knows. The composition is the only place that names them: each one is a
 * module of its own and the shared code works through the catalog. Registering again replaces.
 */
export function registerBuiltinClientAgents(): void {
  for (const agent of [projectorAgent, claudeAgent, codexAgent, opencodeAgent, kimiAgent])
    registerClientAgent(agent);
}
