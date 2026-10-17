import { createAcpBackend } from "../acp/index.ts";
import { createCodexDialect } from "./dialect.ts";

/**
 * Codex through its ACP server. The adapter ships as a package rather than in the CLI, so it prefers
 * a global `codex-acp` binary and only falls back to `npx`, pinned to a reviewed version.
 */
export const codexProgram = {
  id: "codex",
  label: "Codex",
  command: "npx",
  args: ["-y", "@agentclientprotocol/codex-acp@2.1.1"],
  binary: "codex-acp",
  dialect: createCodexDialect,
};

export const codexBackend = createAcpBackend(codexProgram);
