import { computed, reactive } from "vue";
import { useProjects, type Project } from "../../project/index.ts";
import {
  answerPermission,
  fetchControls,
  fetchDefaults,
  fetchSessions,
  loadSessionTurns,
  saveDefault,
  streamAgent,
} from "../api/client.ts";
import type {
  AgentBackendId,
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentHistoryTurn,
  AgentTurn,
  AgentCommandRequest,
  AgentPermission,
  AgentPermissionMode,
} from "./types.ts";

const createState = () =>
  reactive({
    turns: [] as AgentTurn[],
    draft: "",
    busy: false,
    error: "",
    phase: "",
    permissions: [] as AgentPermission[],
    permissionMode: "default" as AgentPermissionMode,
    controls: [] as AgentControl[],
    selection: {} as AgentSelection,
    controlsError: "",
    sessions: [] as AgentSessionInfo[],
    sessionsLoading: false,
    sessionsError: "",
    abort: undefined as AbortController | undefined,
  });

function summarize(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 8000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 8000);
  } catch {
    return "";
  }
}

/** The saved choice per agent is read once; new chats start from it. */
let defaultsLoad: Promise<Record<string, AgentSelection>> | undefined;
const savedDefaults = () =>
  (defaultsLoad ??= fetchDefaults().catch((): Record<string, AgentSelection> => ({})));

const sessions = new Map<string, ReturnType<typeof createState>>();
const loads = new Map<string, Promise<void>>();
const saves = new Map<string, Promise<void>>();
export function useAgent(
  projectId = "",
  commands?: (request: AgentCommandRequest) => Promise<unknown>,
  /** External-agent chats are separate conversations: one per `chatId`, no Projector tools. */
  options: { backend?: AgentBackendId; chatId?: string } = {},
) {
  const backend = options.backend ?? "projector";
  const key =
    backend === "projector" ? projectId : `${backend}:${projectId}:${options.chatId ?? "main"}`;
  if (!sessions.has(key)) sessions.set(key, createState());
  const state = sessions.get(key)!;

  const historyUrl = `/api/agent/history/${encodeURIComponent(key || "catalog")}`;
  if (!loads.has(key))
    loads.set(
      key,
      fetch(historyUrl)
        .then(async (response) => {
          if (!response.ok) throw new Error("Не удалось загрузить историю чата");
          const data = await response.json();
          state.turns = data.turns;
          for (const turn of state.turns)
            for (const chip of turn.tools) {
              if (chip.status === "running") {
                chip.status = "error";
                chip.detail = "Выполнение прервано";
              }
            }
        })
        .catch((error) => {
          state.error = error.message;
        }),
    );
  const ready = loads.get(key)!;
  function persist() {
    const body = JSON.stringify({ turns: state.turns.slice(-200) });
    const saving = (saves.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const response = await fetch(historyUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!response.ok) throw new Error("Не удалось сохранить историю чата");
      });
    saves.set(key, saving);
    void saving.catch((error) => {
      state.error = error.message;
    });
  }
  const catalog = useProjects();
  const turns = computed(() => state.turns);
  const draft = computed({
    get: () => state.draft,
    set: (value: string) => {
      state.draft = value;
    },
  });
  const busy = computed(() => state.busy);
  const error = computed({
    get: () => state.error,
    set: (value: string) => {
      state.error = value;
    },
  });
  const phase = computed(() => state.phase);
  const permissions = computed(() => state.permissions);
  const permissionMode = computed({
    get: () => state.permissionMode,
    set: (value: AgentPermissionMode) => {
      state.permissionMode = value;
    },
  });

  const external = backend !== "projector";
  const controls = computed(() => state.controls);
  const selection = computed(() => state.selection);
  const sessionList = computed(() => state.sessions);

  /** Marks the chosen option as the control's current one, so the UI shows what will be used. */
  function withChoice(list: AgentControl[]): AgentControl[] {
    return list.map((control) => {
      const chosen = state.selection[control.id];
      return chosen && control.options.some((option) => option.value === chosen)
        ? { ...control, current: chosen }
        : control;
    });
  }

  /** Reads what the agent offers and starts from the saved choice for this agent. */
  async function loadControls(): Promise<void> {
    if (!external || !projectId) return;
    state.selection = { ...((await savedDefaults())[backend] ?? {}), ...state.selection };
    try {
      state.controls = withChoice(await fetchControls(backend, projectId));
      state.controlsError = "";
    } catch (err) {
      state.controlsError = err instanceof Error ? err.message : "Не удалось получить настройки";
    }
  }

  /** Chooses a model, effort or mode; it applies from the next message and is remembered. */
  async function setControl(id: string, value: string): Promise<void> {
    const control = state.controls.find((item) => item.id === id);
    if (!control) throw new Error(`Нет настройки «${id}»`);
    if (!control.options.some((option) => option.value === value))
      throw new Error(`У настройки «${control.name}» нет значения «${value}»`);
    state.selection = { ...state.selection, [id]: value };
    state.controls = withChoice(state.controls);
    try {
      await saveDefault(backend, id, value);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось сохранить выбор";
    }
  }

  /** Past sessions of this agent in the project, newest first. */
  async function loadSessions(): Promise<AgentSessionInfo[]> {
    if (!external || !projectId) return [];
    state.sessionsLoading = true;
    try {
      state.sessions = await fetchSessions(backend, projectId);
      state.sessionsError = "";
    } catch (err) {
      state.sessionsError = err instanceof Error ? err.message : "Не удалось получить сессии";
    } finally {
      state.sessionsLoading = false;
    }
    return state.sessions;
  }

  /** Replaces this chat with a past session of the agent and continues it from the next message. */
  async function resumeSession(id: string): Promise<void> {
    await ready;
    if (state.busy) throw new Error("Дождитесь окончания ответа");
    state.error = "";
    try {
      state.turns = await loadSessionTurns(backend, projectId, id);
      persist();
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось открыть сессию";
      throw err;
    }
  }

  /** The native session of the last answer, so Claude Code continues the same conversation. */
  function sessionId(): string | undefined {
    return state.turns.findLast((item) => item.role === "assistant")?.session?.id;
  }

  async function decide(id: string, allow: boolean, always = false): Promise<void> {
    state.permissions = state.permissions.filter((item) => item.id !== id);
    try {
      await answerPermission(id, allow, always);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось передать решение";
    }
  }

  function history(): AgentHistoryTurn[] {
    return state.turns
      .filter((item) => item.text.trim())
      .map((item) => ({ role: item.role, content: item.text }));
  }

  async function send(text?: string): Promise<void> {
    await ready;
    const message = (text ?? state.draft).trim();
    if (!message || state.busy) return;
    state.draft = "";
    state.error = "";
    state.busy = true;
    state.phase = "думает";
    const previousHistory = history();
    const resume = sessionId();
    state.abort = new AbortController();
    const userTurn: AgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: message,
      tools: [],
    };
    const assistant = reactive<AgentTurn>({
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      tools: [],
    });
    state.turns.push(userTurn, assistant);

    try {
      await streamAgent(
        message,
        previousHistory,
        (event) => {
          if (event.event === "status") {
            state.phase = event.data.model
              ? `${event.data.provider ?? "qwen"} · ${event.data.model}`
              : "думает";
          }
          if (event.event === "session") assistant.session = event.data;
          if (event.event === "controls") {
            // What the agent really applied wins over a choice it refused.
            state.controls = event.data.controls;
            state.selection = {
              ...state.selection,
              ...Object.fromEntries(event.data.controls.map((item) => [item.id, item.current])),
            };
          }
          if (event.event === "permission-request")
            state.permissions.push({
              id: event.data.id,
              tool: event.data.tool,
              title: event.data.title || event.data.tool,
              detail: event.data.detail?.trim() || summarize(event.data.input),
              persistent: event.data.persistent === true,
            });
          if (event.event === "text") assistant.text += event.data.text;
          if (event.event === "tool") {
            if (assistant.text.trim() && !assistant.text.endsWith("\n\n")) assistant.text += "\n\n";
            assistant.tools.push({
              id: event.data.id,
              name: event.data.name,
              status: "running",
              detail: summarize(event.data.input),
            });
          }
          if (event.event === "tool-result") {
            const chip = assistant.tools.find((item) => item.id === event.data.id);
            if (chip) {
              chip.status = event.data.error ? "error" : "done";
              chip.detail = event.data.error || summarize(event.data.output);
            }
          }
          if (event.event === "project") catalog.ingest(event.data as Project);
          if (event.event === "error") state.error = event.data.error;
        },
        state.abort.signal,
        {
          projectId: projectId || undefined,
          sessionId: resume,
          commands,
          backend,
          permissionMode: state.permissionMode,
          selection: state.selection,
        },
      );
    } catch (err) {
      if (!state.abort?.signal.aborted)
        state.error = err instanceof Error ? err.message : "Агент не ответил";
    } finally {
      state.abort?.abort();
      for (const chip of assistant.tools)
        if (chip.status === "running") {
          chip.status = "error";
          chip.detail = "Выполнение прервано";
        }
      state.busy = false;
      state.phase = "";
      state.permissions = [];
      persist();
    }
  }

  async function clear(): Promise<void> {
    await ready;
    if (state.busy) return;
    state.turns = [];
    state.error = "";
    state.phase = "";
    state.draft = "";
    persist();
  }

  const stop = () => state.abort?.abort();
  return {
    turns,
    draft,
    busy,
    error,
    phase,
    permissions,
    permissionMode,
    controls,
    selection,
    controlsError: computed(() => state.controlsError),
    sessions: sessionList,
    sessionsLoading: computed(() => state.sessionsLoading),
    sessionsError: computed(() => state.sessionsError),
    loadControls,
    setControl,
    loadSessions,
    resumeSession,
    send,
    clear,
    stop,
    decide,
  };
}
