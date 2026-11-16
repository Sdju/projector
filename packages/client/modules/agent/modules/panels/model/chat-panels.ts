import type {
  AgentBackendId,
  AgentChat,
  ChatMcp,
  ChatSide,
  ChatWorktree,
} from "../../../../agent-core/index.ts";
import { fetchMcpServers } from "../../../../agent-core/index.ts";
import type { SideQuestion } from "./side-question.ts";

/** The side question panel as the chat's commands see it. */
export function chatSideGroup(side: SideQuestion): ChatSide {
  return {
    status: () => side.status(),
    openSide: () => side.openPanel(),
    askSide: (text) => side.ask(text),
    clearSide: () => side.clear(),
  };
}

/** The MCP servers of the chat's agent: read on demand, as the probe starts a process. */
export function chatMcpGroup(backend: AgentBackendId, projectId: string): ChatMcp {
  return {
    mcpServers: () => fetchMcpServers(backend, projectId),
  };
}

/** The isolated copy of the project that the chat started; `setIsolate` arms one for its first message. */
export function chatWorktreeGroup(chat: AgentChat): ChatWorktree {
  return {
    worktree: async () => (chat.worktreeId() ? chat.worktreeInfo() : undefined),
    mergeWorktree: chat.mergeCopy,
    discardWorktree: chat.discardCopy,
    setIsolate: (on) => {
      chat.isolate.value = on;
    },
  };
}
