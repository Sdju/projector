import type { AgentJobStatus } from "../api/jobs.ts";
import { formatElapsed } from "./elapsed.ts";

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

export function jobDuration(
  start: number | undefined,
  end: number | undefined,
  now = Date.now(),
): string {
  if (!start) return "";
  return formatElapsed((end ?? now) - start);
}
