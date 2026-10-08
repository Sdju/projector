import type {
  AgentBackendId,
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentTurn,
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

/** The run to rejoin no longer exists on the server (finished and collected, or pruned). */
export class AgentRunGone extends Error {}

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
    selection?: AgentSelection;
    commands?: (request: AgentCommandRequest) => Promise<unknown>;
    /** Rejoin the answer an agent process is still producing instead of asking again. */
    attach?: string;
  } = {},
): Promise<void> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      options.attach
        ? { attach: options.attach, approvals: true, commandBridge: !!options.commands }
        : {
            message,
            history,
            projectId: options.projectId,
            sessionId: options.sessionId,
            backend: options.backend,
            permissionMode: options.permissionMode,
            selection: options.selection,
            approvals: true,
            commandBridge: !!options.commands,
          },
    ),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    const message = payload?.error || "Агент недоступен";
    throw response.status === 404 ? new AgentRunGone(message) : new Error(message);
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

/** Stops an answer in progress; closing the page only detaches from it. */
export async function cancelAgentRun(runId: string): Promise<void> {
  await fetch("/api/agent/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
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

async function getJson<T>(url: string, init: RequestInit | undefined, failure: string): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || failure);
  return data as T;
}

const query = (backend: AgentBackendId, projectId: string) =>
  `backend=${encodeURIComponent(backend)}&projectId=${encodeURIComponent(projectId)}`;

/** Models, effort levels and modes the agent offers in this project. */
export async function fetchControls(
  backend: AgentBackendId,
  projectId: string,
): Promise<AgentControl[]> {
  const data = await getJson<{ controls: AgentControl[] }>(
    `/api/agent/controls?${query(backend, projectId)}`,
    undefined,
    "Не удалось получить настройки агента",
  );
  return data.controls;
}

/** The last choice per agent, remembered on disk. */
export async function fetchDefaults(): Promise<Record<string, AgentSelection>> {
  const data = await getJson<{ defaults: Record<string, AgentSelection> }>(
    "/api/agent/defaults",
    undefined,
    "Не удалось получить выбор агента",
  );
  return data.defaults;
}

export async function saveDefault(backend: AgentBackendId, id: string, value: string) {
  await getJson(
    "/api/agent/defaults",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend, id, value }),
    },
    "Не удалось сохранить выбор агента",
  );
}

export async function fetchSessions(
  backend: AgentBackendId,
  projectId: string,
): Promise<AgentSessionInfo[]> {
  const data = await getJson<{ sessions: AgentSessionInfo[] }>(
    `/api/agent/sessions?${query(backend, projectId)}`,
    undefined,
    "Не удалось получить сессии агента",
  );
  return data.sessions;
}

/** The messages of a past session, ready to show in the chat. */
export async function loadSessionTurns(
  backend: AgentBackendId,
  projectId: string,
  sessionId: string,
): Promise<AgentTurn[]> {
  const data = await getJson<{ turns: AgentTurn[] }>(
    "/api/agent/sessions/load",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend, projectId, sessionId }),
    },
    "Не удалось открыть сессию",
  );
  return data.turns;
}
