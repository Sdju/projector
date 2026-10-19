import type { AgentTaskPatch } from "../../../../core/modules/agent-task/index.ts";

export type AcpTaskPatch = AgentTaskPatch;

export type AcpUpdate = Record<string, unknown>;

/**
 * What one ACP agent adds to the protocol. ACP leaves subagents, background commands and streamed
 * command output to each agent's own extensions, so everything specific to an agent lives in its
 * dialect (the agent module's `dialect.ts`) and the shared mapper only talks to this interface. A dialect
 * holds the state of one chat run: create one per run through `AcpProgram.dialect`.
 */
export interface AcpDialect {
  /** How a tool call is shown: its name, and the call it was made inside of. */
  tool(update: AcpUpdate): { name: string; parent?: string };
  /**
   * A message chunk that is not part of the answer (a subagent's): the task changes it causes,
   * and the mapper drops the text. `undefined` is a chunk of the answer itself.
   */
  chunk(update: AcpUpdate, text: string): AcpTaskPatch[] | undefined;
  /** The update comes from inside a subagent, not from the agent answering the user. */
  inner(update: AcpUpdate): boolean;
  /** Any tool call or its update: subagents and background commands it starts or advances. */
  call(update: AcpUpdate, id: string): AcpTaskPatch[];
  /** Command output the agent streamed outside of the final update; read once per call. */
  output(id: string): string;
  /** A tool call ended with `output`. */
  end(update: AcpUpdate, id: string, output: string): AcpTaskPatch[];
  /** The agent started writing the answer: work it left open runs on without it. */
  speak(): AcpTaskPatch[];
  /** The answer ended. */
  finish(): AcpTaskPatch[];
  /** When a replayed message was written, if its `messageId` tells (ms since the epoch). */
  time(update: AcpUpdate): number | undefined;
}

const UUID_V7 = /^([0-9a-f]{8})-?([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The time a UUIDv7 carries in its first 48 bits. */
export function uuidV7Time(id: unknown): number | undefined {
  const match = typeof id === "string" ? UUID_V7.exec(id) : null;
  if (!match) return undefined;
  const time = parseInt(match[1]! + match[2]!, 16);
  return time > 0 ? time : undefined;
}

/** An agent without extensions: every call is a plain tool call. */
export function createPlainDialect(): AcpDialect {
  return {
    tool: (update) => ({ name: String(update.title || update.kind || "tool") }),
    inner: () => false,
    chunk: () => undefined,
    call: () => [],
    output: () => "",
    end: () => [],
    speak: () => [],
    finish: () => [],
    time: (update) => uuidV7Time(update.messageId),
  };
}

/** A dialect that changes only part of the plain one. */
export function extendPlainDialect(parts: Partial<AcpDialect>): AcpDialect {
  return { ...createPlainDialect(), ...parts };
}

export function inputOf(update: AcpUpdate): Record<string, unknown> {
  const input = update.rawInput;
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

export const isOver = (update: AcpUpdate) =>
  update.status === "completed" || update.status === "failed";

/** The last line of what an agent said, cut to fit a row. */
export function shorten(text: string, limit = 200) {
  const line = text.trim().split("\n").at(-1) ?? "";
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}
