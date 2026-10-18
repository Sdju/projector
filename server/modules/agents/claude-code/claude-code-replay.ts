import type { AgentTask } from "../../../../core/modules/agent-task/index.ts";
import type { AgentSessionTurn } from "../../agent/index.ts";

/** Records Claude Code writes into the user's side of a transcript that the user never wrote. */
const SERVICE_BLOCK =
  /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder)>[\s\S]*?<\/\1>/g;

/** Only the trace of a slash command or a reminder, nothing the user typed. */
export const isServiceText = (text: string): boolean =>
  text.includes("<") && !text.replace(SERVICE_BLOCK, "").trim();

/** The summary Claude Code puts in as the first message after the context was compacted. */
export const isCompactSummary = (text: string): boolean =>
  text.trimStart().startsWith("This session is being continued from a previous conversation");

export interface TaskReport {
  taskId: string;
  toolUseId?: string;
  status: AgentTask["status"];
  summary?: string;
}

const tag = (text: string, name: string): string | undefined =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() || undefined;

/** A background task's report, which Claude Code delivers as a user message. */
export function parseTaskReport(text: string): TaskReport | undefined {
  if (!text.trimStart().startsWith("<task-notification>")) return undefined;
  const taskId = tag(text, "task-id");
  if (!taskId) return undefined;
  const status = tag(text, "status");
  return {
    taskId,
    toolUseId: tag(text, "tool-use-id"),
    status: status === "completed" ? "done" : status === "failed" ? "error" : "stopped",
    summary: tag(text, "summary"),
  };
}

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/** The task a tool call starts, if it starts one: a subagent or a command left in the background. */
export function taskOfCall(
  name: string | undefined,
  id: string,
  input: unknown,
): AgentTask | undefined {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
  const background = args.run_in_background === true;
  if (name && SUBAGENT_TOOLS.has(name))
    return {
      id,
      kind: "agent",
      title: text("description") ?? text("subagent_type") ?? "Субагент",
      status: "running",
      background,
      tool: id,
      ...(text("subagent_type") ? { subagent: text("subagent_type") } : {}),
      ...(text("prompt") ? { prompt: text("prompt") } : {}),
    };
  if (name === "Bash" && background)
    return {
      id,
      kind: "shell",
      title: text("description") ?? text("command") ?? "Команда",
      status: "running",
      background,
      tool: id,
    };
  return undefined;
}

/** Applies a report to the task it is about; the task is found by the call that started it. */
export function applyTaskReport(turns: readonly AgentSessionTurn[], report: TaskReport): void {
  for (const turn of turns)
    for (const task of turn.tasks ?? [])
      if (task.id === report.toolUseId || task.id === report.taskId) {
        task.status = report.status;
        if (report.summary) task.summary = report.summary;
        return;
      }
}

/** The answer is over: what is still running has no report in the transcript. */
export function settleTasks(turns: readonly AgentSessionTurn[]): void {
  for (const turn of turns)
    for (const task of turn.tasks ?? [])
      if (task.status === "running") {
        task.status = "stopped";
        if (task.background) task.summary ??= "Состояние после ответа неизвестно";
      }
}
