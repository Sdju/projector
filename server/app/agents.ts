import { registerAgentBackend } from "../modules/agent/index.ts";
import { claudeCodeBackend } from "../modules/agents/claude-code/index.ts";
import { codexBackend } from "../modules/agents/codex/index.ts";
import { cursorBackend } from "../modules/agents/cursor/index.ts";
import { opencodeBackend } from "../modules/agents/opencode/index.ts";
import { projectorBackend } from "../modules/agents/projector/index.ts";

/**
 * The agents this server offers. The composition is the only place that names them: each agent
 * module stays independent and the generic core never imports one. Registering again replaces.
 */
export function registerBuiltinAgents(): void {
  registerAgentBackend(projectorBackend, { asDefault: true });
  registerAgentBackend(claudeCodeBackend);
  registerAgentBackend(codexBackend);
  registerAgentBackend(opencodeBackend);
  registerAgentBackend(cursorBackend);
}
