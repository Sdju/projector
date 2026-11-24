import type { AgentFailure } from "@ai-projector/core/modules/agent-failure/index.ts";
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
  /** Gives the adapter the path to an installed executable when the env override is unset. */
  executableEnv?: { name: string; command: string };
  /**
   * Overrides of the terminal that opens the agent: the program id defaults to `id`, the
   * executable to `id` and the tab title to `label`.
   */
  terminal?: Partial<AgentTerminal>;
  /** What the agent adds to ACP (subagents, background commands); plain when absent. */
  dialect?: () => AcpDialect;
  /** The shell command when the agent keeps it outside `rawInput.command`. */
  shellCommand?: (toolCall: Record<string, unknown>) => string;
  /** A native session has one owner, including while its background work runs. */
  exclusiveSession?: boolean;
  /** Stream the answer immediately, but send the final done after background tasks finish. */
  finishAfterBackground?: boolean;
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
  /** Capture ownership before sending the prompt, including fast autonomous continuations. */
  prepareFollowUp?: (sessionId: string) => AcpFollowUp;
  /**
   * Shown when the agent refuses a session with an auth error instead of auto-calling ACP
   * `authenticate` (for CLIs whose interactive browser login would block stdio).
   */
  authHint?: string;
  /** Ambient env keys stripped before launch overrides are merged (e.g. `GEMINI_API_KEY`). */
  scrubEnv?: readonly string[];
  /** Slash command names hidden from chat menus (e.g. `logout` on a shared host CLI). */
  withheldCommands?: readonly string[];
  /** Optional handler for non-approval `session/request_permission` prompts (e.g. questions). */
  permissionRequest?: (
    options: AgentRunOptions,
    params: Record<string, unknown>,
  ) => Promise<unknown> | undefined;
  /**
   * Thin-client mode: never inject Projector feature/role/widget instructions, systemPrompt
   * metadata, or replayed chat history into prompts; the agent owns its prompt and history.
   */
  nativePromptOnly?: boolean;
  /** Optional post-turn check for agents that report upstream errors as `end_turn` or `refusal`. */
  watchPromptOutcome?: (
    sessionId: string,
  ) => Promise<(stopReason: unknown) => Promise<AgentFailure | undefined>>;
}

export type AcpFollowUpResult =
  | { status: "completed" | "superseded" | "aborted" }
  | { status: "failed" | "unavailable" | "timeout"; error: string };

export interface AcpFollowUpOptions {
  signal?: AbortSignal;
  onStart?: () => void;
  /** Agent requests awaiting a client reply, including user approvals. */
  incomingActivity?: () => { pending: number; lastReplyAt: number };
  /** Poll child completions on every iteration, including children spawned by continuations. */
  pending: () => number;
}

export interface AcpFollowUp {
  /** Reject updates owned by a later human prompt before they reach the answer mapper. */
  acceptsUpdates(sessionId: string, update: Record<string, unknown>): boolean;
  wait(options: AcpFollowUpOptions): Promise<AcpFollowUpResult>;
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

/** Whether an id belongs to an ACP program, without throwing for other backends. */
export function hasAcpProgram(id: AgentBackendId): boolean {
  return programs.has(id);
}

/** Every registered ACP program, in registration order. */
export function acpPrograms(): AcpProgram[] {
  return [...programs.values()];
}
