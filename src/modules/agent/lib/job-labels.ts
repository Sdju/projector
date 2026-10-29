import type { AgentJobStatus } from "../api/jobs.ts";

export const jobStatusLabel: Record<AgentJobStatus, string> = {
  queued: "Запускается",
  running: "Работает",
  "needs-user": "Ждёт вас",
  done: "Готово",
  error: "Ошибка",
  stopped: "Остановлено",
};

/** The name of the chat tab (`ide.workbench.<name>.open`) of each external agent. */
export const jobChatTab: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  cursor: "cursor",
  kimi: "kimi",
};

export function jobDuration(start: number | undefined, end: number | undefined): string {
  if (!start) return "";
  const seconds = Math.max(0, Math.round(((end ?? Date.now()) - start) / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} мин ${seconds % 60} с`
    : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
