import type {
  AgentBackendId,
  AgentEvent,
  AgentHistoryTurn,
  AgentCommandRequest,
  AgentPermissionMode,
} from "../model/types.ts";

function parseSse(buffer: string): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const chunk of parts) {
    let name = "";
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!name) continue;
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join("\n") || "{}") } as AgentEvent);
    } catch {
      events.push({ event: "error", data: { error: "Некорректный поток" } });
    }
  }
  return { events, rest };
}

export async function streamAgent(
  message: string,
  history: AgentHistoryTurn[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  options: {
    projectId?: string;
    sessionId?: string;
    backend?: AgentBackendId;
    permissionMode?: AgentPermissionMode;
    commands?: (request: AgentCommandRequest) => Promise<unknown>;
  } = {},
): Promise<void> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      projectId: options.projectId,
      sessionId: options.sessionId,
      backend: options.backend,
      permissionMode: options.permissionMode,
      approvals: true,
      commandBridge: !!options.commands,
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Агент недоступен");
  }

  async function handle(event: AgentEvent) {
    if (event.event !== "command-request") return onEvent(event);
    let result: { output?: unknown; error?: string };
    try {
      if (!options.commands) throw new Error("Команды недоступны в этом чате");
      result = { output: await options.commands(event.data) };
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    const reply = await fetch("/api/agent/tool-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: event.data.id, ...result }),
      signal,
    });
    if (!reply.ok) throw new Error("Не удалось передать результат команды агенту");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) await handle(event);
  }
  if (buffer.trim()) {
    const parsed = parseSse(`${buffer}\n\n`);
    for (const event of parsed.events) await handle(event);
  }
}

/** Answers a `permission-request` event; the ID is a single-use capability from that stream. */
export async function answerPermission(id: string, allow: boolean, always = false): Promise<void> {
  const response = await fetch("/api/agent/tool-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, output: { allow, always } }),
  });
  if (!response.ok) throw new Error("Запрос разрешения уже закрыт");
}
