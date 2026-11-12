import type {
  AgentBackendId,
  AgentControl,
  AgentRunOptions,
  AgentSelection,
  AgentTerminal,
} from "../../agent/index.ts";
import type { AcpDialect } from "./acp-dialect.ts";

/** A property of an ACP form schema. */
export interface AcpFormField {
  key: string;
  schema: Record<string, unknown>;
}

/** A choice of a form question. */
export interface AcpFormOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * How an agent shapes the forms it asks (`elicitation/create`). The common part reads plain JSON
 * Schema on its own; this optional dialect only covers what an agent adds on top of it.
 */
export interface AcpFormAdapter {
  /** Whether this property is the free-text companion of another question. */
  companion(field: AcpFormField, properties: Record<string, unknown>): boolean;
  /** The question id a companion belongs to; absent falls back to stripping `_note`/`_custom`. */
  baseOf(field: AcpFormField): string | undefined;
  /** The option the agent reads as "none of these" when only the companion holds the answer. */
  fallbackOption(options: AcpFormOption[]): AcpFormOption | undefined;
}

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
  /** Arguments of `binary`; empty when the binary takes none (default). */
  binaryArgs?: string[];
  /**
   * Overrides of the terminal that opens the agent: the program id defaults to `id`, the
   * executable to `id` and the tab title to `label`.
   */
  terminal?: Partial<AgentTerminal>;
  /** What the agent adds to ACP (subagents, background commands); plain when absent. */
  dialect?: () => AcpDialect;
  /** The optional dialect of the agent's forms; the plain part works without it. */
  forms?: AcpFormAdapter;
  /**
   * Extra `initialize.clientCapabilities` this agent needs beyond the shared ACP ones. Nested
   * objects are merged one level (`_meta` of the program is added, `fs` is not replaced).
   */
  clientCapabilities?: Record<string, unknown>;
  /**
   * Rewrites stored choices before they are applied: an older combined value may become several
   * knobs once the agent offers them separately. The program owns the rewrite; the shared client
   * only calls it.
   */
  normalizeSelection?: (selection: AgentSelection, controls: AgentControl[]) => AgentSelection;
  /** The agent's own request methods (outside ACP), answered by the handler it names. */
  extensions?: Record<
    string,
    (options: AgentRunOptions, params: Record<string, unknown>) => Promise<unknown>
  >;
  /** Notifications the agent sends outside `session/update`; fire-and-forget. */
  notifications?: Record<
    string,
    (options: AgentRunOptions, params: Record<string, unknown>) => void
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
