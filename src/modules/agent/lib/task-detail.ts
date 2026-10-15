import type { AgentTask, AgentToolChip, AgentTurn } from "../model/types.ts";

/** A task with what the chat knows about it: the call that started it and the calls it made. */
export interface AgentTaskDetail {
  task: AgentTask;
  /** The call that started the task: its input is the assignment, its result the outcome. */
  call?: AgentToolChip;
  /** Calls the subagent made inside of itself. */
  calls: AgentToolChip[];
}

/** Tasks of the whole chat, once each; a background task of an earlier answer may still run. */
export function chatTasks(turns: AgentTurn[]): AgentTask[] {
  const byId = new Map<string, AgentTask>();
  for (const turn of turns) for (const task of turn.tasks ?? []) byId.set(task.id, task);
  return [...byId.values()];
}

/** What the bar above the input shows: the tasks of the latest answer and any still running. */
export function barTasks(turns: AgentTurn[]): AgentTask[] {
  const latest = new Set(
    turns.findLast((turn) => turn.role === "assistant")?.tasks?.map((t) => t.id),
  );
  return chatTasks(turns).filter((task) => task.status === "running" || latest.has(task.id));
}

export function taskDetail(turns: AgentTurn[], id: string): AgentTaskDetail | undefined {
  const task = chatTasks(turns).find((item) => item.id === id);
  if (!task) return undefined;
  const tools = turns.flatMap((turn) => turn.tools);
  const call = task.tool ? tools.find((tool) => tool.id === task.tool) : undefined;
  return {
    task,
    call,
    calls: call ? tools.filter((tool) => tool.parent === call.id) : [],
  };
}

export function taskDuration(ms?: number) {
  if (!ms) return "";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

export const taskStatusLabel = {
  running: "Выполняется",
  done: "Готово",
  error: "Ошибка",
  stopped: "Остановлено",
} as const;

/** One line for the tab readout of the built-in agent. */
export function taskReadout(detail: AgentTaskDetail): string {
  const { task, call, calls } = detail;
  return [
    `${task.title || "Задача"} — ${taskStatusLabel[task.status]}`,
    task.subagent ? `Субагент: ${task.subagent}` : "",
    call?.input ? `Задание: ${call.input.slice(0, 1000)}` : "",
    calls.length ? `Вызовы: ${calls.map((c) => `${c.name} — ${c.status}`).join("; ")}` : "",
    task.summary ? `Итог: ${task.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
