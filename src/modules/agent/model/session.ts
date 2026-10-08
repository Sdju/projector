import { computed, reactive } from "vue";
import { useProjects } from "../../project/index.ts";
import { AgentRunGone, answerPermission, cancelAgentRun, streamAgent } from "../api/client.ts";
import {
  RELEASE_DELAY_MS,
  createState,
  loads,
  releases,
  saves,
  sessions,
  viewers,
} from "./chat-state.ts";
import { useExternalAgent } from "./external.ts";
import { applyAgentEvent } from "./turn-events.ts";
import type {
  AgentBackendId,
  AgentEvent,
  AgentHistoryTurn,
  AgentTurn,
  AgentCommandRequest,
  AgentPermissionMode,
} from "./types.ts";

/** A restarting server answers again within seconds; this much patience covers a slow restart. */
const REJOIN_DELAY_MS = 1000;
const REJOIN_ATTEMPTS = 60;
const INTERRUPTED =
  "Ответ прерван: страница или сервер были перезапущены. Отправьте сообщение ещё раз — разговор продолжится.";

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
          // One with a live agent process behind it is rejoined instead (`resumeRun`).
          const last = state.turns.at(-1);
          if (last?.role === "assistant" && !last.run && !last.text.trim() && !last.tools.length)
            last.text = INTERRUPTED;
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

  /**
   * Runs one answer on the chat: `start` streams events, which are folded into `assistant`.
   * The agent process outlives the server, so when the stream breaks while the answer is still
   * open (a server restart), the chat rejoins the run and takes the whole answer again.
   */
  async function runTurn(
    assistant: AgentTurn,
    start: (
      onEvent: (event: AgentEvent) => void,
      signal: AbortSignal,
      attach?: string,
    ) => Promise<void>,
    firstAttach?: string,
  ): Promise<void> {
    state.busy = true;
    state.phase = "думает";
    state.abort = new AbortController();
    const { signal } = state.abort;
    const onEvent = (event: AgentEvent) => {
      if (applyAgentEvent(state, assistant, event, catalog.ingest)) persist();
    };
    try {
      let attach = firstAttach;
      for (let attempt = 0; ; attempt++) {
        if (attach) {
          assistant.text = "";
          assistant.tools.splice(0);
        }
        try {
          await start(onEvent, signal, attach);
          if (signal.aborted || !assistant.run) break;
        } catch (err) {
          if (err instanceof AgentRunGone || signal.aborted || !assistant.run) throw err;
          if (attempt >= REJOIN_ATTEMPTS) throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, REJOIN_DELAY_MS));
        attach = assistant.run;
        if (signal.aborted || !attach) break;
      }
    } catch (err) {
      if (err instanceof AgentRunGone) {
        assistant.run = undefined;
        if (!assistant.text.trim()) assistant.text = INTERRUPTED;
      } else if (!signal.aborted)
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

  async function send(text?: string): Promise<void> {
    await ready;
    const message = (text ?? state.draft).trim();
    if (!message || state.busy) return;
    state.draft = "";
    state.error = "";
    const previousHistory = history();
    const resume = sessionId();
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
    await runTurn(assistant, (onEvent, signal, attach) =>
      streamAgent(message, previousHistory, onEvent, signal, {
        projectId: projectId || undefined,
        sessionId: resume,
        commands,
        backend,
        permissionMode: state.permissionMode,
        selection: state.selection,
        attach,
      }),
    );
  }

  /**
   * An answer that was still being produced when the page or the server went away: the agent
   * process kept working, so its whole answer is replayed into the same turn.
   */
  async function resumeRun(): Promise<void> {
    await ready;
    const assistant = state.turns.at(-1);
    if (state.busy || assistant?.role !== "assistant" || !assistant.run) return;
    await runTurn(
      assistant,
      (onEvent, signal, attach) =>
        streamAgent("", [], onEvent, signal, {
          projectId: projectId || undefined,
          commands,
          backend,
          attach,
        }),
      assistant.run,
    );
  }
  void resumeRun();

  async function clear(): Promise<void> {
    await ready;
    if (state.busy) return;
    state.turns = [];
    state.error = "";
    state.phase = "";
    state.draft = "";
    persist();
  }

  /** Stops the answer. Only this cancels an agent process; closing the page just detaches from it. */
  function stop() {
    const assistant = state.turns.at(-1);
    const run = assistant?.run;
    if (assistant && run) {
      assistant.run = undefined;
      void cancelAgentRun(run).catch(() => {});
    }
    state.abort?.abort();
  }
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
