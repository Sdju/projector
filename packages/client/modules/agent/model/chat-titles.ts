import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { chatTabTitle } from "../lib/chat-name.ts";
import { loadSessionTitles } from "./job-titles.ts";
import type { AgentBackendId, AgentSessionInfo, AgentTurn } from "./types.ts";

const RETRY_MS = 5_000;
const RETRY_LIMIT = 6;

/**
 * The name of a chat's tab. The agent names its session while it works, so the session list is
 * read again until the title appears; before that the tab says what the chat is about. The
 * Projector agent has no native sessions: its tab is named by the first message alone.
 */
export function useChatTitle(chat: {
  projectId: () => string;
  backend: () => AgentBackendId;
  /** The native session the chat continues; absent for the Projector agent. */
  session: () => string | undefined;
  /** The first message: the chat's own name before the agent names the session. */
  firstMessage: () => string;
  /** What the tab says while the chat is empty: the agent's label. */
  fallback: () => string;
  /** An answer is running: the agent may name the session before it ends. */
  running: () => boolean;
  /** Sessions already read for the history panel: a rename reaches the tab without a request. */
  known?: () => AgentSessionInfo[];
}): ComputedRef<string> {
  const titles = ref<Map<string, string>>(new Map());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let generation = 0;

  /** A title from the history panel wins: it is what the user last saw there. */
  function titleOf(id: string): string {
    const known = chat
      .known?.()
      .find((session) => session.id === id)
      ?.title.trim();
    return known || titles.value.get(id)?.trim() || "";
  }

  async function refresh(force = false): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const project = chat.projectId();
    const id = chat.session();
    const mine = ++generation;
    if (!project || !id) return;
    if (titleOf(id)) return;
    const entry = await loadSessionTitles(chat.backend(), project, force);
    if (mine !== generation) return;
    titles.value = entry.titles;
    if (!titleOf(id) && chat.running() && attempts < RETRY_LIMIT) {
      attempts++;
      timer = setTimeout(() => void refresh(true), RETRY_MS);
    }
  }

  watch(
    [
      () => chat.projectId(),
      () => chat.backend(),
      () => chat.session(),
      () => chat.running(),
      () => chat.known?.(),
    ],
    () => {
      attempts = 0;
      void refresh();
    },
    { immediate: true },
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      generation++;
      clearTimeout(timer);
    });

  return computed(() => {
    const id = chat.session();
    return chatTabTitle(id ? titleOf(id) : "", chat.firstMessage(), chat.fallback());
  });
}

/** Wires the tab title of an agent chat: its session name, else its first message, else the label. */
export function useAgentChatTabTitle(
  emit: (event: "title", title: string) => void,
  props: { projectId: string; backend?: AgentBackendId },
  turns: ComputedRef<AgentTurn[]>,
  busy: ComputedRef<boolean>,
  sessions: ComputedRef<AgentSessionInfo[]>,
  agentName: ComputedRef<string>,
): void {
  const title = useChatTitle({
    projectId: () => props.projectId,
    backend: () => props.backend ?? "projector",
    session: () => turns.value.findLast((turn) => turn.role === "assistant")?.session?.id,
    firstMessage: () => turns.value.find((turn) => turn.role === "user" && !turn.auto)?.text ?? "",
    fallback: () => agentName.value,
    running: () => busy.value,
    known: () => sessions.value,
  });
  watch(title, (name) => emit("title", name), { immediate: true });
}
