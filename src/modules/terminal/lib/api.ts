import type { TerminalSession } from "../../../../core/modules/terminal/index.ts";

export class TerminalRequestError extends Error {
  readonly session?: TerminalSession;
  constructor(message: string, session?: TerminalSession) {
    super(message);
    this.session = session;
  }
}

export async function terminalRequest<T>(
  projectId: string,
  suffix = "",
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/terminals${suffix}`,
    { ...init, headers: { "Content-Type": "application/json" } },
  );
  const data = await response.json();
  if (!response.ok) throw new TerminalRequestError(data.error || "Ошибка терминала", data.session);
  return data as T;
}
