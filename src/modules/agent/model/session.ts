import { computed, reactive } from "vue";
import { useProjects, type Project } from "../../project/index.ts";
import { answerPermission, streamAgent } from "../api/client.ts";
import {
  RELEASE_DELAY_MS,
  createState,
  loads,
  releases,
  saves,
  sessions,
  summarize,
  viewers,
} from "./chat-state.ts";
import { useExternalAgent } from "./external.ts";
import type {
  AgentBackendId,
  AgentHistoryTurn,
  AgentTurn,
  AgentCommandRequest,
  AgentPermissionMode,
} from "./types.ts";

export function useAgent(
  projectId = "",
  commands?: (request: AgentCommandRequest) => Promise<unknown>,
  /** External-agent chats are separate conversations: one per `chatId`, no Projector tools. */
  options: { backend?: AgentBackendId; chatId?: string } = {},
) {
  const backend = options.backend ?? "projector";
  const key =
    backend === "projector" ? projectId : `${backend}:${projectId}:${options.chatId ?? "main"}`;
  clearTimeout(releases.get(key));
  releases.delete(key);
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
          // A turn saved at its start but never finished: the page or server went away mid-answer.
          const last = state.turns.at(-1);
          if (last?.role === "assistant" && !last.text.trim() && !last.tools.length) {
            last.text =
              "Ответ прерван: страница или сервер были перезапущены. Отправьте сообщение ещё раз — разговор продолжится.";
          }
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

  const {
    controls,
    selection,
    sessions: sessionList,
    loadControls,
    setControl,
    loadSessions,
    resumeSession,
  } = useExternalAgent(state, { backend, projectId, ready, persist });
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
    // Saved now, not only at the end: a reload or restart mid-answer must not lose the question
    // or the native session the next message resumes.
    persist();

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
          if (event.event === "session") {
            assistant.session = event.data;
            persist();
          }
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
  /** A chat view starts showing this chat; pair it with `release`. */
  function attach() {
    viewers.set(key, (viewers.get(key) ?? 0) + 1);
  }
  /** The chat view went away: stop its request unless the same chat is shown again shortly. */
  function release() {
    viewers.set(key, Math.max(0, (viewers.get(key) ?? 1) - 1));
    if (viewers.get(key)) return;
    clearTimeout(releases.get(key));
    releases.set(
      key,
      setTimeout(() => {
        releases.delete(key);
        if (!viewers.get(key)) state.abort?.abort();
      }, RELEASE_DELAY_MS),
    );
  }
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
    attach,
    release,
    decide,
  };
}
