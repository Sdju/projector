import { computed } from "vue";
import {
  fetchCommands,
  fetchControls,
  fetchDefaults,
  fetchLiveRuns,
  fetchSessions,
  loadSessionTurns,
  saveDefault,
} from "../api/client.ts";
import { deleteSession, updateSession } from "../api/sessions.ts";
import {
  archiveChat,
  deleteChat,
  fetchChats,
  fetchRecentChats,
  openChat,
  updateChat,
} from "../api/chats.ts";
import { saves, type ChatState } from "./chat-state.ts";
import { requestChatTab } from "./job-open.ts";
import type {
  AgentBackendId,
  AgentControl,
  AgentRecentChat,
  AgentSelection,
  AgentSessionInfo,
} from "./types.ts";

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
    /** Where the chat is saved; the Projector agent's past chats are kept per key. */
    key: string;
  },
) {
  const { backend, projectId, ready, persist, key } = chat;
  const external = backend !== "projector";
  // The Projector agent offers a model and permission choice but has no sessions; its slash commands are the user's skills and prompt commands.
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
    if (external && !projectId) return;
    await ready;
    if (state.permissionMode !== "default" && !state.selection["permission-mode"])
      state.selection["permission-mode"] = state.permissionMode;
    state.selection = { ...((await savedDefaults())[backend] ?? {}), ...state.selection };
    try {
      const offered = await fetchControls(backend, projectId);
      state.capabilities = offered.capabilities;
      state.controls = withChoice(offered.controls);
      state.controlsError = "";
    } catch (err) {
      state.controlsError = err instanceof Error ? err.message : "Не удалось получить настройки";
    }
  }

  /** Reads the slash commands the agent offers; without them `/` suggests nothing. */
  async function loadCommands(): Promise<void> {
    if (external && !projectId) return;
    try {
      state.commands = await fetchCommands(backend, projectId);
    } catch {
      // Agents that only list commands during a turn (ACP) have none until then.
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
      const defaults = await savedDefaults();
      defaults[backend] = { ...defaults[backend], [id]: value };
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось сохранить выбор";
    }
  }

  /** Past sessions of this agent in the project, newest first. */
  async function loadSessions(): Promise<AgentSessionInfo[]> {
    if (external && !projectId) return [];
    state.sessionsLoading = true;
    try {
      state.sessions = external ? await fetchSessions(backend, projectId) : await fetchChats(key);
      state.sessionsError = "";
    } catch (err) {
      state.sessionsError = err instanceof Error ? err.message : "Не удалось получить сессии";
    } finally {
      state.sessionsLoading = false;
    }
    return state.sessions;
  }

  /** Chats of the project kept on disk (including closed tabs), newest first. */
  async function loadRecent(): Promise<AgentRecentChat[]> {
    if (!projectId) {
      state.recent = [];
      return [];
    }
    state.recentLoading = true;
    try {
      state.recent = await fetchRecentChats(projectId, backend);
      state.recentError = "";
    } catch (err) {
      state.recentError = err instanceof Error ? err.message : "Не удалось получить недавние чаты";
    } finally {
      state.recentLoading = false;
    }
    return state.recent;
  }

  /** Renames a past session or pins it; the list is read again to show the result. */
  async function changeSession(
    id: string,
    change: { title?: string; pinned?: boolean },
  ): Promise<void> {
    try {
      if (external) await updateSession(backend, projectId, id, change);
      else await updateChat(id, change);
      await loadSessions();
    } catch (err) {
      state.sessionsError = err instanceof Error ? err.message : "Не удалось изменить сессию";
    }
  }

  /** What the chat last did has reached the server, so a history action sees all of it. */
  async function flush(): Promise<void> {
    persist();
    await saves.get(key)?.catch(() => {});
  }

  /** The chat is another one now: what belonged to the previous one no longer applies. */
  function resetChat(): void {
    state.queue = [];
    state.stash = undefined;
    state.editing = "";
    state.draft = "";
    state.draftParts = [];
  }

  /**
   * A new, empty chat. The Projector agent keeps what was said in the history of chats; the
   * others, whose sessions the agent itself keeps, just start over.
   */
  async function clear(): Promise<void> {
    await ready;
    if (state.busy) return;
    try {
      if (!external) {
        await flush();
        await archiveChat(key);
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось начать новый чат";
      return;
    }
    state.turns = [];
    resetChat();
    state.error = "";
    state.phase = "";
    persist();
  }

  async function removeSession(id: string): Promise<void> {
    try {
      if (external) await deleteSession(backend, projectId, id);
      else await deleteChat(id);
      await loadSessions();
    } catch (err) {
      state.sessionsError = err instanceof Error ? err.message : "Не удалось удалить чат";
      throw err;
    }
  }

  /** Brings forward the chat whose agent process still works on the session; `false` when none does. */
  async function showLiveChat(session: string): Promise<boolean> {
    const run = (await fetchLiveRuns().catch(() => [])).find(
      (item) => item.session === session && item.projectId === projectId && item.chat,
    );
    if (!run) return false;
    return run.chat === key || requestChatTab(projectId, run.chat);
  }

  /** Replaces this chat with a past session of the agent and continues it from the next message. */
  async function resumeSession(id: string): Promise<void> {
    await ready;
    if (state.busy) throw new Error("Дождитесь окончания ответа");
    // The session still works in the background (the agent process lives on without its tab):
    // its own chat shows it as running, a copy read from the transcript would show it as over.
    if (external && (await showLiveChat(id))) return;
    state.error = "";
    state.loading = true;
    try {
      if (external) {
        state.turns = await loadSessionTurns(backend, projectId, id);
        persist();
      } else {
        await flush();
        state.turns = (await openChat(key, id)).turns;
        resetChat();
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось открыть сессию";
      throw err;
    } finally {
      state.loading = false;
    }
  }

  return {
    controls,
    selection,
    sessions: sessionList,
    loadControls,
    loadCommands,
    setControl,
    loadSessions,
    loadRecent,
    recent: computed(() => state.recent),
    recentLoading: computed(() => state.recentLoading),
    recentError: computed(() => state.recentError),
    changeSession,
    resumeSession,
    removeSession,
    clear,
  };
}
