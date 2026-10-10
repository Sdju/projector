import { rewindAgentFiles, type RewindSummary } from "../api/client.ts";
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
    if (last && (backend !== "claude-code" || !last.tail)) last.detached = true;
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

  /** Takes a sent message back into the input to be changed and sent again. */
  function edit(id: string): void {
    const user = cutBack(id);
    if (!user) return;
    state.draft = user.text;
    state.draftParts = user.content ?? [];
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
    detach();
    persist();
  }

  /** The session this message ran in: what its files were backed up under. */
  function sessionOf(id: string): string | undefined {
    const index = state.turns.findIndex((turn) => turn.id === id && turn.role === "user");
    const answer = state.turns[index + 1];
    return answer?.role === "assistant" ? answer.session?.id : undefined;
  }

  /** Whether the files can be taken back to before this message (only Claude Code keeps backups). */
  function canRewindFiles(id: string): boolean {
    return backend === "claude-code" && !!sessionOf(id);
  }

  /** Puts the project's files back to how they were before the message; `dryRun` only reports. */
  async function rewindFiles(id: string, dryRun: boolean): Promise<RewindSummary> {
    await ready;
    const session = sessionOf(id);
    if (!canRewindFiles(id) || !session)
      throw new Error("Файлы к этому шагу вернуть нельзя: резервной копии нет");
    if (state.busy) throw new Error("Дождитесь окончания ответа");
    return rewindAgentFiles({
      backend,
      projectId,
      sessionId: session,
      messageId: id,
      dryRun,
    });
  }

  return {
    drainQueue,
    sendQueuedNow,
    removeQueued,
    edit,
    retry,
    showVersion,
    canRewindFiles,
    rewindFiles,
  };
}
