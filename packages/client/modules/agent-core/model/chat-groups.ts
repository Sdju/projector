import type {
  ChatBranch,
  ChatControls,
  ChatFlow,
  ChatHistory,
  ChatQueue,
  ChatRef,
  ChatSessions,
} from "./chat-contracts.ts";
import { chatTasks } from "../lib/task-detail.ts";
import type { RewindSummary } from "../api/client.ts";
import type { useAgent } from "./session.ts";
import type { AgentBackendId } from "./types.ts";

/** Everything `useAgent` publishes: the groups below read the chat state it owns. */
export type AgentChat = ReturnType<typeof useAgent>;

/** The identity and live state every chat command starts from. */
export function chatRefGroup(
  chat: AgentChat,
  options: {
    projectId: string;
    backend: AgentBackendId;
    label: string;
    visible: () => boolean;
  },
): ChatRef {
  return {
    key: chat.key,
    projectId: options.projectId,
    backend: options.backend,
    label: options.label,
    busy: () => chat.busy.value,
    needsUser: () =>
      chat.permissions.value.length > 0 ||
      chat.questions.value.length > 0 ||
      chat.secrets.value.length > 0,
    visible: options.visible,
    turns: () => chat.turns.value,
    tasks: () => chatTasks(chat.turns.value),
    capabilities: () => chat.capabilities.value,
  };
}

/** The choices of the parameters island. */
export function chatControlsGroup(chat: AgentChat): ChatControls {
  return {
    controls: () => chat.controls.value,
    selection: () => chat.selection.value,
    setControl: chat.setControl,
  };
}

/** Sending, injecting and reworking the answer, plus the branch of it. */
export function chatFlowGroup(
  chat: AgentChat,
  options: { compact: () => Promise<void>; fork: ChatBranch["fork"] },
): ChatFlow & ChatBranch {
  return {
    send: (text) => chat.send(text),
    inject: async (text) => {
      await chat.send(text);
      const item = chat.queue.value.findLast((entry) => entry.text === text.trim());
      if (!item) return false;
      return chat.injectQueued(item.id);
    },
    stop: chat.stop,
    edit: chat.edit,
    retry: chat.retry,
    compact: options.compact,
    fork: options.fork,
  };
}

/** The export and the rollback of the conversation. */
export function chatHistoryGroup(
  chat: AgentChat,
  options: {
    exportMarkdown: () => string;
    rewindTo: (
      turnId: string,
      scope: Parameters<ChatHistory["rewind"]>[1],
    ) => Promise<RewindSummary | undefined>;
  },
): ChatHistory {
  return {
    exportMarkdown: options.exportMarkdown,
    showVersion: chat.showVersion,
    rewind: async (turnId, scope) =>
      (await options.rewindTo(turnId, scope)) ?? { ok: true, files: [] },
  };
}

/** Messages waiting for the current answer to end. */
export function chatQueueGroup(chat: AgentChat): ChatQueue {
  return {
    queue: () => chat.queue.value,
    removeQueued: chat.removeQueued,
  };
}

/** The past sessions of the agent behind the chat. */
export function chatSessionsGroup(chat: AgentChat): ChatSessions {
  return {
    loadSessions: chat.loadSessions,
    resumeSession: chat.resumeSession,
    removeSession: chat.removeSession,
  };
}
