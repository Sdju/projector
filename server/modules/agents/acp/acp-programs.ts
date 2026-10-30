import type { AgentBackendId, AgentRunOptions, AgentTerminal } from "../../agent/index.ts";
import type { AcpDialect } from "./acp-dialect.ts";

/**
 * A coding agent reached over the Agent Client Protocol. Each agent module declares its own program:
 * the command, what the agent adds to ACP, and any request methods it defines beyond ACP.
 */
export interface AcpProgram {
  id: AgentBackendId;
  /** Human label for the chat header and the status line. */
  label: string;
  /** Executable of the ACP server and its arguments. */
  command: string;
  args: string[];
  /** A globally installed binary that replaces `command` when present (avoids `npx`). */
  binary?: string;
  /**
   * Overrides of the terminal that opens the agent: the program id defaults to `id`, the
   * executable to `id` and the tab title to `label`.
   */
  terminal?: Partial<AgentTerminal>;
  /** What the agent adds to ACP (subagents, background commands); plain when absent. */
  dialect?: () => AcpDialect;
  /** The agent's own request methods (outside ACP), answered by the handler it names. */
  extensions?: Record<
    string,
    (options: AgentRunOptions, params: Record<string, unknown>) => Promise<unknown>
  >;
}

const programs = new Map<AgentBackendId, AcpProgram>();

/** Adds a program to the ACP runtime; the agent module that declares it does this once. */
export function registerAcpProgram(program: AcpProgram): void {
  programs.set(program.id, program);
}

export function acpProgram(id: AgentBackendId): AcpProgram {
  const program = programs.get(id);
  if (!program) throw new Error(`Неизвестный ACP-агент: ${id}`);
  return program;
}
