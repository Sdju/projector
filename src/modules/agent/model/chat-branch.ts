import { computed } from "vue";
import { chatTabCommand } from "../lib/chat-tab.ts";
import type { ForkMode } from "./branches.ts";
import { forkChat } from "./chat-fork.ts";
import type { AgentBackendId, AgentCapabilities, AgentRecentChat, AgentTurn } from "./types.ts";

/** The part of the IDE command service a branch needs: opening the tab of the new chat. */
export interface BranchCommands {
  executeCommand(id: string, args?: unknown, options?: { scope?: string }): unknown;
}

/**
 * Forking a chat and reopening closed ones. A chat is a tab that comes and goes, so the actions
 * live beside it: a new branch is written under its own key, and the project's chat list is how a
 * closed tab is found again.
 */
export function useChatBranch(chat: {
  backend: AgentBackendId;
  projectId: string;
  /** The current chat, left out of the project's list. */
  key: string;
  turns: () => AgentTurn[];
  capabilities: () => AgentCapabilities;
  recent: () => AgentRecentChat[];
  api: BranchCommands;
  fail: (message: string) => void;
}) {
  const scope = `editor:${chat.projectId}`;

  /** Starts a new chat from the turns before (or up to) a message; the original is untouched. */
  async function fork(id: string, mode: ForkMode = "before"): Promise<{ chat: string }> {
    const branch = await forkChat({
      backend: chat.backend,
      projectId: chat.projectId,
      turns: chat.turns(),
      turnId: id,
      mode,
      branchSession: chat.capabilities().branchSession,
    });
    const tab = chatTabCommand(chat.projectId, branch.chat, branch.title);
    if (!tab) throw new Error("Для этой ветки нет вкладки чата");
    await chat.api.executeCommand(tab.command, tab.args, { scope });
    return { chat: branch.chat };
  }

  async function forkMessage(id: string, mode: ForkMode): Promise<void> {
    try {
      await fork(id, mode);
    } catch (cause) {
      chat.fail(cause instanceof Error ? cause.message : "Не удалось ответвить чат");
    }
  }

  /** A chat of the project opens in its tab; one already open gets the focus. */
  function openRecent(key: string, title?: string): void {
    const tab = chatTabCommand(chat.projectId, key, title);
    if (!tab) return;
    void Promise.resolve(chat.api.executeCommand(tab.command, tab.args, { scope })).catch(
      (cause: unknown) => {
        chat.fail(cause instanceof Error ? cause.message : "Не удалось открыть чат");
      },
    );
  }

  /** Chats the panel can bring back: the current one is already on screen. */
  const recentChats = computed(() =>
    chat
      .recent()
      .filter((item) => item.chat !== chat.key && !!chatTabCommand(chat.projectId, item.chat)),
  );

  return { fork, forkMessage, openRecent, recentChats };
}
