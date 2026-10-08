import { computed } from "vue";
import {
  fetchControls,
  fetchDefaults,
  fetchSessions,
  loadSessionTurns,
  saveDefault,
} from "../api/client.ts";
import type { ChatState } from "./chat-state.ts";
import type { AgentBackendId, AgentControl, AgentSelection, AgentSessionInfo } from "./types.ts";

/** The saved choice per agent is read once; new chats start from it. */
let defaultsLoad: Promise<Record<string, AgentSelection>> | undefined;
const savedDefaults = () =>
  (defaultsLoad ??= fetchDefaults().catch((): Record<string, AgentSelection> => ({})));

/**
 * Model, effort, mode and past sessions of an external agent's chat. The chat itself (turns,
 * streaming, permissions) stays in `useAgent`; this part only needs its state and `persist`.
 */
export function useExternalAgent(
  state: ChatState,
  chat: {
    backend: AgentBackendId;
    projectId: string;
    ready: Promise<void>;
    persist: () => void;
  },
) {
  const { backend, projectId, ready, persist } = chat;
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

  return {
    controls,
    selection,
    sessions: sessionList,
    loadControls,
    setControl,
    loadSessions,
    resumeSession,
  };
}
