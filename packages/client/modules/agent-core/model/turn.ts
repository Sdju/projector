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

/** What Answer Doctor found and did with a finished answer; saved with the turn. */
export interface AgentDoctorReport {
  status: "fixed" | "failed";
  /** How many repair attempts the doctor used. */
  attempts: number;
  /** The first problem the client check found. */
  problem: string;
  /** The diagnosis after the last attempt, when the doctor gave up. */
  remaining?: string;
  /** Milliseconds spent from the first diagnosis to the last attempt. */
  took: number;
  /** FNV-1a hash of the repaired text: an edited or repeated answer hides the old report. */
  answer: number;
  /** When the doctor finished (ms since the epoch). */
  at: number;
}

/** Answer Doctor's live state on the answer it is repairing; not saved. */
export interface AgentDoctorProgress {
  status: "repairing" | "failed";
  /** The attempt in progress, or the last attempt after a failure. */
  attempts: number;
  /** How many attempts the client allows. */
  limit: number;
  /** The first problem the client check found. */
  problem: string;
  /** What is still wrong after the last attempt. */
  remaining?: string;
}

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
  /** What Answer Doctor did with this answer, kept so the mark stays after a reload. */
  doctor?: AgentDoctorReport;
  /**
   * On a user turn: the other versions of the conversation from this message on, which exist
   * after the message was edited or its answer repeated. Each version starts with a user turn.
   */
  variants?: AgentTurn[][];
  /** Which place the shown version takes among `variants` and itself. */
  slot?: number;
}
