import type { AgentBackendId } from "./backend.ts";

export interface AcpProgram {
  /** Human label for the chat header and the status line. */
  label: string;
  /** Executable of the ACP server and its arguments. */
  command: string;
  args: string[];
  /** A globally installed binary that replaces `command` when present (avoids `npx`). */
  binary?: string;
}

/**
 * External coding agents exposed to the chat through the Agent Client Protocol over stdio.
 * Each program keeps its own login, config and project rules; Projector only drives the protocol.
 * Codex's ACP server ships as an adapter package rather than in the CLI, so it prefers a global
 * `codex-acp` binary and only falls back to `npx`, pinned to a reviewed version so the host never
 * runs whatever was published last.
 */
export const ACP_PROGRAMS: Partial<Record<AgentBackendId, AcpProgram>> = {
  opencode: { label: "OpenCode", command: "opencode", args: ["acp"] },
  cursor: { label: "Cursor", command: "agent", args: ["acp"] },
  codex: {
    label: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp@2.1.1"],
    binary: "codex-acp",
  },
};
