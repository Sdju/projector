import type { ChatRef } from "../model/chat-contracts.ts";

/** A required text argument of a chat command. */
export function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`Укажите ${key}`);
  return value;
}

/** The newest message of the user, which `edit`, `retry` and `rewind` take when no turn is named. */
export function turnArg(
  chat: Pick<ChatRef, "turns">,
  args: Record<string, unknown>,
  role: "user" | "assistant",
): string {
  if (typeof args.turnId === "string" && args.turnId) return args.turnId;
  const turn = chat.turns().findLast((item) => item.role === role);
  if (!turn) throw new Error("В чате ещё нет сообщений");
  return turn.id;
}
