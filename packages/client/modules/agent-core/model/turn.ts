import type { AgentTask } from "@ai-projector/core/modules/agent-task/index.ts";
import type {
  AgentContext,
  AgentFormAnswer,
  AgentPart,
  AgentSessionRef,
  AgentToolChip,
  AgentUsage,
  MessagePart,
} from "./types.ts";

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** When the message was written (ms since the epoch); absent in turns saved before it existed. */
  at?: number;
  tools: AgentToolChip[];
  /** Subagents and background commands the agent started during this answer. */
  tasks?: AgentTask[];
  /** What the user wrote, with chips; `text` holds the same message as plain text. */
  content?: MessagePart[];
  /** On a user turn from a native session: Projector's instructions before the user's text. */
  injected?: string;
  /** On a user turn: the form that was filled instead of typing, shown in place of the text. */
  form?: AgentFormAnswer;
  /** Order of text and tool calls; absent in turns saved before it existed. */
  parts?: AgentPart[];
  /** The turn ended on its budget, not on an answer: the chat offers to continue it. */
  stopped?: "steps" | "loop" | "tokens" | "time";
  /** The answer failed: what the agent or its stream reported, kept so the chat can offer retry. */
  failure?: string;
  /** The IDE wrote this message, not the user: the id of the job that triggered it. */
  auto?: string;
  /** What to call that job in the note; the id stays for the agent's commands. */
  autoTitle?: string;
  /** Context fullness after this turn; the chat shows the latest one. */
  context?: AgentContext;
  /** Tokens of this answer and how much of the prompt the cache served. */
  usage?: AgentUsage;
  /** Native backend session (Claude Code) this turn belongs to; the next request resumes it. */
  session?: AgentSessionRef;
  /** The agent process still answering this turn; set until the turn ends, so it can be rejoined. */
  run?: string;
  /** The isolated copy of the project this answer was written in. */
  worktree?: { id: string; branch: string };
  /** Where this answer ends in the agent's transcript; the next message branches off from here. */
  tail?: string;
  /** The agent's own session cannot go on from this turn (the chat was cut back): replay instead. */
  detached?: boolean;
  /**
   * On a user turn: the other versions of the conversation from this message on, which exist
   * after the message was edited or its answer repeated. Each version starts with a user turn.
   */
  variants?: AgentTurn[][];
  /** Which place the shown version takes among `variants` and itself. */
  slot?: number;
}
