import { computed } from "vue";
import {
  discardWorktree,
  fetchWorktree,
  injectAgentMessage,
  mergeWorktree,
  rewindAgentFiles,
  type RewindSummary,
  type WorktreeInfo,
} from "../api/client.ts";
import { legacyParts } from "./turn-events.ts";
import { cutAt, switchVersion } from "./branches.ts";
import type { ChatState } from "./chat-state.ts";
import type { AgentBackendId, AgentTurn, MessagePart } from "./types.ts";

/**
 * What the user does with a chat beyond writing the next message: queue messages while the agent
 * works, take a message back to change it, ask again, switch between the versions that leaves, and
 * put the project's files back to an earlier step.
 */
export function useChatActions(
  state: ChatState,
  chat: {
    backend: AgentBackendId;
    projectId: string;
    ready: Promise<void>;
    persist: () => void;
    send: (text?: string, chips?: MessagePart[]) => Promise<void>;
    stop: () => void;
  },
) {
  const { backend, projectId, ready, persist, send, stop } = chat;

  /**
   * After the chat was cut back, an agent that cannot go back inside its own session starts a new
   * one from the replayed text; Claude Code branches off the kept answer instead.
   */
  function detach() {
    const last = state.turns.findLast((item) => item.role === "assistant");
    if (last && (!state.capabilities.branchSession || !last.tail)) last.detached = true;
  }

  /** Sends the next queued message once the answer is over; a stopped or failed one waits. */
  function drainQueue(held: boolean) {
    if (state.busy || !state.queue.length) return;
    if (held || (state.error && !state.interrupting)) {
      state.interrupting = false;
      return;
    }
    state.interrupting = false;
    const next = state.queue.shift()!;
    void send(next.text, next.parts);
  }

  /** Stops the answer in progress and sends this queued message instead. */
  async function sendQueuedNow(id: string): Promise<void> {
    const index = state.queue.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [item] = state.queue.splice(index, 1);
    state.queue.unshift(item!);
    if (!state.busy) return drainQueue(false);
    state.interrupting = true;
    stop();
  }

  /**
   * Adds a queued message to the answer being written, so the agent takes it into account now
   * (Claude Code reads it ahead of what it was doing). It stays in the answer as the user's own bubble.
   */
  async function injectQueued(id: string): Promise<boolean> {
    const item = state.queue.find((entry) => entry.id === id);
    if (!item || !state.busy || !state.capabilities.inject || !state.activeMessage) return false;
    let accepted = false;
    try {
      accepted = await injectAgentMessage(state.activeMessage, item.text);
    } catch {
      accepted = false;
    }
    if (!accepted) {
      state.error = "Ответ уже закончился: сообщение осталось в очереди";
      return false;
    }
    removeQueued(id);
    const answer = state.turns.at(-1);
    if (answer?.role === "assistant") {
      (answer.parts ??= legacyParts(answer)).push({ type: "note", text: item.text });
      persist();
    }
    return true;
  }

  function removeQueued(id: string): void {
    state.queue = state.queue.filter((item) => item.id !== id);
  }

  /**
   * Cuts the chat back to just before the user message `id`. What was cut stays as another
   * version of that point, which the next message becomes the newest of.
   */
  function cutBack(id: string): AgentTurn | undefined {
    const index = state.turns.findIndex((turn) => turn.id === id && turn.role === "user");
    if (index < 0 || state.busy) return undefined;
    const user = state.turns[index]!;
    const { text, content } = user;
    state.stash = { index, versions: cutAt(state.turns, index) };
    state.error = "";
    detach();
    persist();
    return { ...user, text, content, tools: [] };
  }

  /**
   * Takes a sent message into the input to be changed. Nothing is cut yet: the chat shows what the
   * new message will replace, and only sending it (`applyEdit`) turns that into another version, so
   * a reload or a change of mind loses nothing.
   */
  function edit(id: string): void {
    const user = state.turns.find((turn) => turn.id === id && turn.role === "user");
    if (!user || state.busy) return;
    state.editing = id;
    state.draft = user.text;
    state.draftParts = user.content ?? [];
  }

  /** Gives up the change: the message stays as it was and the input is emptied. */
  function cancelEdit(): void {
    if (!state.editing) return;
    state.editing = "";
    state.draft = "";
    state.draftParts = [];
  }

  /** Sending the edited message: what it replaces is cut off and kept as another version. */
  function applyEdit(): void {
    const id = state.editing;
    state.editing = "";
    const index = state.turns.findIndex((turn) => turn.id === id && turn.role === "user");
    if (index < 0) return;
    state.stash = { index, versions: cutAt(state.turns, index) };
    state.error = "";
    detach();
  }

  /** Asks the same question again; the earlier answer stays as another version. */
  async function retry(id: string): Promise<void> {
    const index = state.turns.findIndex((turn) => turn.id === id);
    const user = state.turns.slice(0, index + 1).findLast((turn) => turn.role === "user");
    if (!user || state.busy) return;
    const cut = cutBack(user.id);
    if (cut) await send(cut.text, cut.content ?? []);
  }

  /** Shows another version of the chat from this message on. */
  function showVersion(id: string, target: number): void {
    const index = state.turns.findIndex((turn) => turn.id === id);
    if (state.busy || index < 0 || !switchVersion(state.turns, index, target)) return;
    state.stash = undefined;
    state.editing = "";
    detach();
    persist();
  }

  /** The session this message ran in: what its files were backed up under. */
  function sessionOf(id: string): string | undefined {
    const index = state.turns.findIndex((turn) => turn.id === id && turn.role === "user");
    const answer = state.turns[index + 1];
    return answer?.role === "assistant" ? answer.session?.id : undefined;
  }

  /** Whether the files can be taken back to before this message (when the backend keeps backups). */
  function canRewindFiles(id: string): boolean {
    return !!state.capabilities.rewindFiles && !!sessionOf(id);
  }

  /** Puts the project's files back to how they were before the message; `dryRun` only reports. */
  async function rewindFiles(id: string, dryRun: boolean): Promise<RewindSummary> {
    await ready;
    if (!canRewindFiles(id)) throw new Error("Файлы к этому шагу вернуть нельзя: копии нет");
    if (state.busy) throw new Error("Дождитесь окончания ответа");
    return rewindAgentFiles({
      backend,
      projectId,
      sessionId: sessionOf(id) ?? "",
      messageId: id,
      dryRun,
      worktree: worktreeId(),
    });
  }

  /** The isolated copy of the project this chat works in, if it was started in one. */
  function worktreeId(): string | undefined {
    return state.turns.findLast((turn) => turn.role === "assistant" && turn.worktree)?.worktree?.id;
  }

  function forget(turns: AgentTurn[], id: string) {
    for (const turn of turns) {
      if (turn.worktree?.id === id) turn.worktree = undefined;
      for (const version of turn.variants ?? []) forget(version, id);
    }
  }

  /** The copy is gone: the agent's own session cannot go on from where it stood. */
  function endWorktree(id: string) {
    forget(state.turns, id);
    const last = state.turns.findLast((turn) => turn.role === "assistant");
    if (last) last.detached = true;
    persist();
  }

  async function worktreeInfo(): Promise<WorktreeInfo | undefined> {
    const id = worktreeId();
    return id ? fetchWorktree(projectId, id) : undefined;
  }

  /** Brings what the agent did in the isolated copy into the project. */
  async function mergeCopy(): Promise<string> {
    const id = worktreeId();
    if (!id) throw new Error("Чат работает не в изолированной копии");
    if (state.busy) throw new Error("Дождитесь окончания ответа");
    const result = await mergeWorktree(projectId, id);
    endWorktree(id);
    return result.message ?? "";
  }

  /** Throws the isolated copy away. */
  async function discardCopy(): Promise<void> {
    const id = worktreeId();
    if (!id) throw new Error("Чат работает не в изолированной копии");
    if (state.busy) throw new Error("Дождитесь окончания ответа");
    await discardWorktree(projectId, id);
    endWorktree(id);
  }

  return {
    drainQueue,
    sendQueuedNow,
    injectQueued,
    removeQueued,
    edit,
    cancelEdit,
    applyEdit,
    retry,
    showVersion,
    canRewindFiles,
    rewindFiles,
    isolate: computed({
      get: () => state.isolate,
      set: (value: boolean) => {
        state.isolate = value;
      },
    }),
    worktreeId,
    worktreeInfo,
    mergeCopy,
    discardCopy,
  };
}
