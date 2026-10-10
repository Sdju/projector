import type { AgentTurn } from "./types.ts";

/** The most other versions of a conversation a message keeps. */
const MAX_VARIANTS = 20;

/**
 * Editing a message or asking again does not throw the earlier answer away: the turns from that
 * message on stay as another version of the chat. The user turn that starts the shown version
 * holds the others (`variants`) and the place the shown one takes among them (`slot`).
 */
export function versionsOf(head: AgentTurn): { count: number; position: number } {
  const count = (head.variants?.length ?? 0) + 1;
  return { count, position: Math.min(head.slot ?? count - 1, count - 1) };
}

/**
 * Removes the turns from `index` on and returns every version of the conversation from that
 * message on, the removed one among them, in the order they are shown to the user.
 */
export function cutAt(turns: AgentTurn[], index: number): AgentTurn[][] {
  const head = turns[index]!;
  const { position } = versionsOf(head);
  const others = head.variants ?? [];
  const shown = turns.splice(index);
  shown[0]!.variants = undefined;
  shown[0]!.slot = undefined;
  return [...others.slice(0, position), shown, ...others.slice(position)];
}

/** Makes `head`, a new message, the newest of the versions it replaces. */
export function addVersion(head: AgentTurn, versions: AgentTurn[][]): void {
  const kept = versions.slice(-MAX_VARIANTS);
  head.variants = kept;
  head.slot = kept.length;
}

/** Shows another version of the conversation from the user turn at `index` on. */
export function switchVersion(turns: AgentTurn[], index: number, target: number): boolean {
  const head = turns[index];
  if (!head || head.role !== "user") return false;
  const { count, position } = versionsOf(head);
  if (target === position || target < 0 || target >= count) return false;
  const others = head.variants ?? [];
  const shown = turns.splice(index);
  shown[0]!.variants = undefined;
  shown[0]!.slot = undefined;
  const all = [...others.slice(0, position), shown, ...others.slice(position)];
  const chosen = all[target]!;
  chosen[0]!.variants = all.filter((_, at) => at !== target);
  chosen[0]!.slot = target;
  turns.push(...chosen);
  return true;
}
