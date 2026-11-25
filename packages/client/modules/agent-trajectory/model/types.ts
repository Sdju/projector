/**
 * The data a trajectory panel renders.
 *
 * The panel is deliberately independent of a chat backend: a source projects its own records into
 * this shape, and the panel never reads `AgentTurn` itself. Today `trajectoryFromTurns` fills the
 * shape from what a chat already keeps. When steps, TTFT or a system prompt become available, they
 * arrive as more records — the panel does not need a new layout.
 */

/** What a ledger row describes. */
export type TrajectoryRecordKind =
  | "user"
  | "assistant"
  | "thought"
  | "tool"
  | "subtool"
  | "task"
  | "note"
  | "judge"
  | "context"
  | "system"
  | "compaction";

/** A record's state, shared by tools, tasks and a whole answer. */
export type TrajectoryRecordStatus = "running" | "done" | "error" | "stopped";

/** A tool call as the panel shows and inspects it. Mirrors the chat's tool chip without its logic. */
export interface TrajectoryTool {
  id: string;
  name: string;
  status: TrajectoryRecordStatus;
  /** What the agent passed to the tool, as text. */
  input?: string;
  /** The result once it arrived; the input while the call still runs. */
  detail: string;
  /** Output streamed while the call is still running. */
  output?: string;
  kind?: string;
  label?: string;
  paths?: string[];
  /** The call of a subagent this call was made inside of. */
  parent?: string;
  startedAt?: number;
  endedAt?: number;
}

/** A subagent or a background command started by an answer. */
export interface TrajectoryTask {
  id: string;
  kind: "agent" | "shell" | "other";
  title: string;
  status: TrajectoryRecordStatus;
  background?: boolean;
  subagent?: string;
  model?: string;
  session?: string;
  tool?: string;
  prompt?: string;
  summary?: string;
  lastTool?: string;
  tools?: number;
  tokens?: number;
  startedAt?: number;
  endedAt?: number;
  log?: string[];
}

/** TTFT and decoding of one assistant step. */
export interface TrajectoryTiming {
  ttftMs?: number;
  decodingMs?: number;
}

/** Disjoint token buckets of one record or one turn. */
export interface TrajectoryUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

/** One row of the ledger. Fields the source cannot provide stay absent, not zero. */
export interface TrajectoryRecord {
  /** Stable across reloads and prepended history. */
  id: string;
  kind: TrajectoryRecordKind;
  /** 1-based request number; 0 for records that arrived without a user message. */
  turn: number;
  /** The row's short name, always present. */
  title: string;
  /** One-line preview; the inspector holds `detail`. */
  text?: string;
  /** Full text for the inspector: markdown for messages, raw text for a call. */
  detail?: string;
  input?: string;
  output?: string;
  status?: TrajectoryRecordStatus;
  /** Unix epoch milliseconds, as recorded by the source. */
  startedAt?: number;
  endedAt?: number;
  /** Own duration when the source recorded both ends. */
  durationMs?: number;
  /** A duration derived from neighbours rather than recorded; the panel marks it. */
  approximate?: boolean;
  /** A tool or task this record belongs to. */
  parentId?: string;
  callId?: string;
  tool?: TrajectoryTool;
  task?: TrajectoryTask;
  usage?: TrajectoryUsage;
  timing?: TrajectoryTiming;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

/** Context-window fullness after a turn. */
export interface TrajectoryContext {
  used: number;
  size: number;
  model?: string;
}

/** One user request and everything the agent did for it. */
export interface TrajectoryTurn {
  /** 1-based request number; 0 for a prologue without a user message. */
  number: number;
  id: string;
  title: string;
  startedAt?: number;
  endedAt?: number;
  status: TrajectoryRecordStatus;
  usage?: TrajectoryUsage;
  context?: TrajectoryContext;
  records: TrajectoryRecord[];
}

/** What the current source can and cannot fill yet. The panel shows this instead of pretending. */
export interface TrajectoryCapabilities {
  /** Model requests / steps inside one answer. */
  steps: boolean;
  /** Time to first token and decoding duration. */
  ttft: boolean;
  tools: boolean;
  tasks: boolean;
  usage: boolean;
  costs: boolean;
  context: boolean;
  compaction: boolean;
  /** A record is still being written. */
  live: boolean;
}

/** Counters over the whole panel. */
export interface TrajectoryCounts {
  turns: number;
  records: number;
  tools: number;
  tasks: number;
  errors: number;
  running: number;
}

/** The complete input of `AgentTrajectoryPanel`. */
export interface TrajectoryData {
  turns: readonly TrajectoryTurn[];
  /** Every record in display order, for the timeline and keyboard navigation. */
  records: readonly TrajectoryRecord[];
  counts: TrajectoryCounts;
  usage: TrajectoryUsage;
  capabilities: TrajectoryCapabilities;
  /** Why some fields are absent, shown once under the title. */
  notice?: string;
}

/** One document as a tab or the right panel shows it. */
export interface TrajectoryDocument {
  id: string;
  title: string;
  subtitle?: string;
  data: TrajectoryData;
  source?: string;
  updatedAt: number;
}

/** How a document is read from a command payload or a `.trajectory.json` file. */
export interface TrajectoryDocumentOptions {
  id?: string;
  title?: string;
  subtitle?: string;
  source?: string;
}
