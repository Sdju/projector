import { newId } from "../../../common/utilities/new-id.ts";
import type { AgentFormAnswer, AgentTurn, MessagePart } from "./types.ts";

/** The user's message as a turn: the text the agent gets, its chips and the form it came from. */
export function userTurnOf(
  message: string,
  content: MessagePart[] | undefined,
  options?: { auto?: string; autoTitle?: string; form?: AgentFormAnswer },
): AgentTurn {
  return {
    id: newId(),
    role: "user",
    text: message,
    at: Date.now(),
    tools: [],
    ...(content ? { content } : {}),
    ...(options?.form ? { form: options.form } : {}),
    ...(options?.auto ? { auto: options.auto } : {}),
    ...(options?.autoTitle ? { autoTitle: options.autoTitle } : {}),
  };
}
