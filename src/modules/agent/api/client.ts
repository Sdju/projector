import type {
  AgentCommand,
  AgentBackendId,
  AgentCapabilities,
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentTurn,
  MessagePart,
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

/** Stores a pasted or dropped image on the server; messages refer to it by the returned id. */
export async function uploadAttachment(
  file: File,
): Promise<Extract<MessagePart, { type: "image" }>> {
  const response = await fetch(`/api/agent/attachments?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить изображение");
  return { type: "image", id: data.id, name: data.name, mime: data.mime };
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
    /** The chat's key, so any page can tell which chat the run belongs to. */
    chat?: string;
    sessionId?: string;
    backend?: AgentBackendId;
    permissionMode?: AgentPermissionMode;
    selection?: AgentSelection;
    /** The message with its chips; `message` carries the same text for agents that read text. */
    parts?: MessagePart[];
    /** The message's own ID, which the agent's transcript keeps (a later rewind refers to it). */
    messageId?: string;
    /** Where the kept conversation ends in the agent's transcript. */
    tail?: string;
    /** The isolated copy of the project the chat works in. */
    worktree?: string;
    /** Start the chat in a new isolated copy of the project. */
    isolate?: boolean;
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
            chat: options.chat,
            sessionId: options.sessionId,
            backend: options.backend,
            permissionMode: options.permissionMode,
            selection: options.selection,
            parts: options.parts,
            messageId: options.messageId,
            tail: options.tail,
            worktree: options.worktree,
            isolate: options.isolate,
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

/** Answers a `question-request` event: answers by question ID, or `null` to skip the questions. */
export async function answerQuestion(
  id: string,
  answers: Record<string, string[]> | null,
): Promise<void> {
  const response = await fetch("/api/agent/tool-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, output: answers ? { answers } : {} }),
  });
  if (!response.ok) throw new Error("Вопрос уже закрыт");
}

/**
 * Answers a `secret-request` event with the typed value, `null` when the user declines. The value
 * goes to the server in this one request and is not kept by the client.
 */
export async function answerSecret(id: string, value: string | null): Promise<void> {
  const response = await fetch("/api/agent/tool-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, output: value ? { value } : {} }),
  });
  if (!response.ok) throw new Error("Запрос секрета уже закрыт");
}

export async function getJson<T>(
  url: string,
  init: RequestInit | undefined,
  failure: string,
): Promise<T> {
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
): Promise<{ controls: AgentControl[]; capabilities: AgentCapabilities }> {
  const data = await getJson<{ controls: AgentControl[]; capabilities: AgentCapabilities }>(
    `/api/agent/controls?${query(backend, projectId)}`,
    undefined,
    "Не удалось получить настройки агента",
  );
  return data;
}

/** Slash commands the agent understands in this project. */
export async function fetchCommands(
  backend: AgentBackendId,
  projectId: string,
): Promise<AgentCommand[]> {
  const data = await getJson<{ commands: AgentCommand[] }>(
    `/api/agent/commands?${query(backend, projectId)}`,
    undefined,
    "Не удалось получить команды агента",
  );
  return data.commands;
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

/** What taking the project's files back to a step changed, or would change. */
export interface RewindSummary {
  ok: boolean;
  error?: string;
  files: string[];
  insertions?: number;
  deletions?: number;
}

/** Puts the files back to how they were before the message; `dryRun` only reports the change. */
export async function rewindAgentFiles(options: {
  backend: AgentBackendId;
  projectId: string;
  sessionId: string;
  messageId: string;
  dryRun: boolean;
  worktree?: string;
}): Promise<RewindSummary> {
  return getJson<RewindSummary>(
    "/api/agent/rewind-files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
    "Не удалось вернуть файлы",
  );
}

export interface McpServer {
  name: string;
  status: string;
  tools: number;
  error?: string;
}

/** MCP servers the agent starts in this project. */
export async function fetchMcpServers(
  backend: AgentBackendId,
  projectId: string,
): Promise<McpServer[]> {
  const data = await getJson<{ servers: McpServer[] }>(
    `/api/agent/mcp?${query(backend, projectId)}`,
    undefined,
    "Не удалось получить MCP-серверы",
  );
  return data.servers;
}

/** Adds a message to the answer being written; `false` when that answer has just ended. */
export async function injectAgentMessage(messageId: string, text: string): Promise<boolean> {
  const response = await fetch("/api/agent/inject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, text }),
  });
  return response.ok;
}

/** How far an isolated copy of the project has moved from the project. */
export interface WorktreeInfo {
  id: string;
  branch: string;
  changed: number;
}

export async function fetchWorktree(projectId: string, id: string): Promise<WorktreeInfo> {
  return getJson<WorktreeInfo>(
    `/api/agent/worktree?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
    undefined,
    "Не удалось получить состояние копии",
  );
}

const post = (url: string, projectId: string, id: string, failure: string) =>
  getJson<{ merged?: boolean; message?: string }>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, id }),
    },
    failure,
  );

/** Brings the isolated copy's changes into the project and deletes the copy. */
export const mergeWorktree = (projectId: string, id: string) =>
  post("/api/agent/worktree/merge", projectId, id, "Не удалось влить изменения");

/** Deletes the isolated copy with everything the agent did in it. */
export const discardWorktree = (projectId: string, id: string) =>
  post("/api/agent/worktree/discard", projectId, id, "Не удалось удалить копию");

/** An agent process working right now, on any page. */
export interface LiveAgentRun {
  id: string;
  backend: AgentBackendId;
  projectId: string;
  chat: string;
  topic: string;
}

export async function fetchLiveRuns(): Promise<LiveAgentRun[]> {
  const response = await fetch("/api/agent/runs", { cache: "no-store" });
  if (!response.ok) return [];
  return (await response.json()).runs ?? [];
}
