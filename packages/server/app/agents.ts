import { listAgentBackends, registerAgentBackend } from "../modules/agent/index.ts";
import { configureAgentPreferences } from "../modules/preferences/index.ts";
import { configureTerminalPrograms } from "../modules/terminal/index.ts";
import { claudeCodeBackend } from "../modules/agents/claude-code/index.ts";
import { codexBackend } from "../modules/agents/codex/index.ts";
import { cursorBackend } from "../modules/agents/cursor/index.ts";
import { kimiBackend } from "../modules/agents/kimi/index.ts";
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
  registerAgentBackend(kimiBackend);
  // The settings ask the live registry instead of keeping their own copy of the list.
  configureAgentPreferences({
    programs: () => listAgentBackends().flatMap(({ program }) => (program ? [program] : [])),
    toggleable: () =>
      listAgentBackends()
        .filter(({ builtin }) => !builtin)
        .map(({ id }) => id),
  });
  // Terminal programs come from the same registry; no list of agents lives in the terminal.
  configureTerminalPrograms(
    (program) =>
      listAgentBackends().find((backend) => backend.terminal?.program === program)?.terminal,
  );
}
