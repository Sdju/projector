import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import { fetchLiveRuns, type LiveAgentRun } from "../api/client.ts";
import { openChats } from "./chat-registry.ts";
import { agentLabel } from "./modes.ts";

/** An open chat that is answering or has subagents and background commands running. */
export interface AgentActivityItem {
  chat: string;
  projectId: string;
  agent: string;
  /** What the user asked last. */
  topic: string;
  busy: boolean;
  /** Subagents and background commands still running. */
  tasks: number;
}

const POLL_MS = 4000;

/**
 * Agents at work on the server. A chat opened on another page, or not open at all, is not in
 * this page's registry, but its agent process is still running.
 */
function useServerRuns() {
  const runs = ref<LiveAgentRun[]>([]);
  async function refresh() {
    if (document.visibilityState !== "visible") return;
    try {
      runs.value = await fetchLiveRuns();
    } catch {
      // The server is restarting; the next poll finds it.
    }
  }
  void refresh();
  const timer = setInterval(() => void refresh(), POLL_MS);
  document.addEventListener("visibilitychange", refresh);
  if (getCurrentScope())
    onScopeDispose(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    });
  return runs;
}

/** Chats that work right now: the open ones of this page and the runs started anywhere else. */
export function useAgentActivity() {
  const serverRuns = useServerRuns();
  const items = computed<AgentActivityItem[]>(() => {
    const local = openChats()
      .map((chat) => ({
        chat: chat.key,
        projectId: chat.projectId,
        agent: chat.label,
        topic:
          chat
            .turns()
            .findLast((turn) => turn.role === "user")
            ?.text.trim()
            .slice(0, 120) ?? "",
        busy: chat.busy(),
        tasks: chat.tasks().filter((task) => task.status === "running").length,
      }))
      .filter((item) => item.busy || item.tasks);
    // The page's own chat knows more (background tasks) than the run on the server.
    const known = new Set(openChats().map((chat) => chat.key));
    const remote = serverRuns.value
      .filter((run) => !run.chat || !known.has(run.chat))
      .map((run) => ({
        chat: run.chat || run.id,
        projectId: run.projectId,
        agent: agentLabel(run.backend),
        topic: run.topic,
        busy: true,
        tasks: 0,
      }));
    return [...local, ...remote];
  });
  return { items };
}
