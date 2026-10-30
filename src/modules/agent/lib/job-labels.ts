import type { AgentJobStatus } from "../api/jobs.ts";
import { clientAgentByBackend } from "../../agents-integration/catalog/index.ts";
import { formatElapsed } from "./elapsed.ts";

export const jobStatusLabel: Record<AgentJobStatus, string> = {
  queued: "Запускается",
  running: "Работает",
  "needs-user": "Ждёт вас",
  done: "Готово",
  error: "Ошибка",
  stopped: "Остановлено",
};

/** The terminal program whose chat tab (`ide.workbench.<program>.open`) holds this backend. */
export function jobChatTab(backend: string): string | undefined {
  const agent = clientAgentByBackend(backend);
  return agent && !agent.builtin ? agent.program : undefined;
}

export function jobDuration(
  start: number | undefined,
  end: number | undefined,
  now = Date.now(),
): string {
  if (!start) return "";
  return formatElapsed((end ?? now) - start);
}
