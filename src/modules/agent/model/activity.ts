import { computed } from "vue";
import { openChats } from "./chat-registry.ts";

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

/** Chats that work right now, across the projects whose workspace is open on this page. */
export function useAgentActivity() {
  const items = computed<AgentActivityItem[]>(() =>
    openChats()
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
      .filter((item) => item.busy || item.tasks),
  );
  return { items };
}
