import IconProjector from "~icons/lucide/bot";
import {
  registerClientAgent,
  type ClientAgent,
} from "../modules/agents-integration/catalog/index.ts";
import { claudeAgent } from "../modules/agents-integration/claude/index.ts";
import { codexAgent } from "../modules/agents-integration/codex/index.ts";
import { opencodeAgent } from "../modules/agents-integration/opencode/index.ts";
import { cursorAgent } from "../modules/agents-integration/cursor/index.ts";
import { kimiAgent } from "../modules/agents-integration/kimi/index.ts";

/** The built-in chat agent: it is not a terminal program, so it has no `clientAgentOf` entry. */
const projectorAgent: ClientAgent = {
  backend: "projector",
  program: "projector",
  title: "Projector",
  caption: "Встроенный агент Projector, история разговоров",
  icon: IconProjector,
  builtin: true,
};

/**
 * The agents the client knows. The composition is the only place that names them: each one is a
 * module of its own and the shared code works through the catalog. Registering again replaces.
 */
export function registerBuiltinClientAgents(): void {
  for (const agent of [
    projectorAgent,
    claudeAgent,
    codexAgent,
    opencodeAgent,
    cursorAgent,
    kimiAgent,
  ])
    registerClientAgent(agent);
}
