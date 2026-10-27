// One Claude Code run, held by its own process so that a server restart or a hot reload leaves the
// answer going (see `runHostedRunner` for the protocol and `claude-code-backend.ts` for the server side).
//
// Usage: node claude-runner.ts <run directory>
import { runHostedRunner } from "../../agent/index.ts";
import { runClaudeCode } from "./claude-code-backend.ts";

runHostedRunner(runClaudeCode);
