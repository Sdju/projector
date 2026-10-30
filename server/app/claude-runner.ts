// One Claude Code run, held by its own process so that a server restart or a hot reload leaves the
// answer going (see `runHostedRunner` for the protocol and `claude-code-backend.ts` for the server side).
//
// Usage: node claude-runner.ts <run directory>
import { runHostedRunner } from "../modules/agent/index.ts";
import { runClaudeCode } from "../modules/agents/claude-code/index.ts";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";

// The server registers these when it starts; the answer's system prompt lists the enabled features.
registerBuiltinWidgetDefinitions();
registerBuiltinAgentFeatures();
// A test imports this module to check the registration without starting an answer; a real host
// passes the run directory as the first argument.
if (process.argv[2]) runHostedRunner(runClaudeCode);
