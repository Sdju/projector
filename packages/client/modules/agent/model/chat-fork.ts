import { newId } from "../../../common/utilities/new-id.ts";
import { forkAt, type ForkMode } from "./branches.ts";
import { chatKeyOf } from "./chat-key.ts";
import { holdDraft } from "./drafts.ts";
import { isBuiltinAgent } from "./modes.ts";
import type { AgentBackendId, AgentTurn } from "./types.ts";

export interface ForkRequest {
  backend: AgentBackendId;
  projectId: string;
  turns: AgentTurn[];
  turnId: string;
  mode: ForkMode;
  /** The agent branches its own native session (Claude Code); others replay the copied turns. */
  branchSession?: boolean;
}

export interface ForkResult {
  /** The key of the new chat, for `ide.workbench.<agent>.open`. */
  chat: string;
  chatId: string;
  /** What the new tab is called: the message the branch starts from. */
  title: string;
}

/** The tab title of a branch: its first line, short enough for the tab strip. */
function branchTitle(slice: { turns: AgentTurn[]; draft?: { text: string } }): string {
  const point =
    slice.draft?.text ??
    [...slice.turns].reverse().find((turn) => turn.role === "user")?.text ??
    "";
  const text = point.replace(/\s+/g, " ").trim();
  if (!text) return "Ветка";
  return `Ветка · ${text.length > 40 ? `${text.slice(0, 39)}…` : text}`;
}

/**
 * Starts a new chat from the turns before (or up to) a message. The source chat is not touched;
 * the new history is saved under its own key before the tab opens, so the tab finds it there.
 */
export async function forkChat(request: ForkRequest): Promise<ForkResult> {
  const { backend, projectId, turns, turnId, mode, branchSession } = request;
  if (!projectId) throw new Error("Форк доступен только в проекте");
  const slice = forkAt(turns, turnId, mode);
  if (!slice) throw new Error("Это сообщение нельзя ответвить");
  // Without a native branch a fork must not load the same agent session: it starts a fresh one and
  // replays the copied history. Otherwise both chats would share one context that grows apart.
  if (!isBuiltinAgent(backend)) {
    const last = slice.turns.findLast((turn) => turn.role === "assistant");
    if (last && (!branchSession || !last.tail)) last.detached = true;
  }
  const chatId = newId();
  const chat = chatKeyOf(backend, projectId, chatId);
  const title = branchTitle(slice);
  const response = await fetch(`/api/agent/history/${encodeURIComponent(chat)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns: slice.turns, projectId, backend, title }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Не удалось сохранить ветку чата");
  }
  if (slice.draft) holdDraft(chat, slice.draft);
  return { chat, chatId, title };
}
