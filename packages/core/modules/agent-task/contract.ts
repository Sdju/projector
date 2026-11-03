import { z } from "zod";

/**
 * A subagent or a background command that works next to an agent's answer. Every agent adapter
 * reports its own kinds of them in this one shape; the chat shows and stores only this.
 */
export const agentTaskSchema = z.object({
  id: z.string(),
  kind: z.enum(["agent", "shell", "other"]),
  title: z.string(),
  status: z.enum(["running", "done", "error", "stopped"]),
  /** Runs without blocking the answer. */
  background: z.boolean(),
  /** Kind of the subagent (`Explore`, `general-purpose`, ...). */
  subagent: z.string().optional(),
  /** The agent's own session of the subagent: its whole conversation can be read from there. */
  session: z.string().optional(),
  /** What it was asked to do, as the agent gave it. */
  prompt: z.string().optional(),
  /** The tool call that started it. */
  tool: z.string().optional(),
  /** The agent does not report when it ends: its state is unknown once the answer is over. */
  untracked: z.boolean().optional(),
  /** One line about what it does now, or how it ended. */
  summary: z.string().optional(),
  lastTool: z.string().optional(),
  tools: z.number().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  /** When the task started and ended (ms since the epoch); the chat fills them in as it sees them. */
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  /** What it reported while working, oldest first; the chat collects it from the patches. */
  log: z.array(z.string()).optional(),
});

export type AgentTask = z.infer<typeof agentTaskSchema>;

/** A change of one task: the fields that changed. The first patch of a task carries all it knows. */
export type AgentTaskPatch = Partial<Omit<AgentTask, "log">> & Pick<AgentTask, "id">;
