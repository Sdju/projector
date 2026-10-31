import { INTERRUPTED } from "./load-history.ts";
import type { AgentTurn } from "./types.ts";

/** The last answer was cut off before it reached the chat: only a placeholder stands there. */
export function answerLost(turn: AgentTurn | undefined): boolean {
  return (
    turn?.role === "assistant" &&
    !turn.run &&
    !turn.tools.length &&
    (!turn.text.trim() || turn.text === INTERRUPTED)
  );
}

/**
 * Copies the answer the agent finished in its own session into the turn the chat lost.
 * The question is matched by its ending, because agent transcripts carry the Projector preamble
 * in front of the user's words; a session continued elsewhere therefore never lends a later
 * answer to an earlier question.
 */
export function restoreLostAnswer(turns: AgentTurn[], native: AgentTurn[]): boolean {
  const lost = turns.at(-1);
  if (!lost || lost.role !== "assistant" || !answerLost(lost)) return false;
  const question = turns.findLast((turn) => turn.role === "user")?.text.trim();
  if (!question) return false;
  const asked = native.findLastIndex(
    (turn) => turn.role === "user" && turn.text.trim().endsWith(question),
  );
  const answer = asked < 0 ? undefined : native[asked + 1];
  if (answer?.role !== "assistant" || !answer.text.trim()) return false;
  lost.text = answer.text;
  lost.tools = answer.tools;
  if (answer.parts) lost.parts = answer.parts;
  if (answer.tasks) lost.tasks = answer.tasks;
  if (answer.usage) lost.usage = answer.usage;
  if (answer.session) lost.session = answer.session;
  if (answer.tail) lost.tail = answer.tail;
  return true;
}

/**
 * Brings back an answer the page never received: the agent keeps its own transcript, so the
 * finished answer is copied from there. `save` stores the repaired chat.
 */
export async function recoverTurn(
  turns: AgentTurn[],
  turn: AgentTurn | undefined,
  load: (session: string) => Promise<AgentTurn[]>,
  save: () => void,
): Promise<boolean> {
  if (!turn?.session?.id || !answerLost(turn)) return false;
  try {
    if (!restoreLostAnswer(turns, await load(turn.session.id))) return false;
  } catch {
    // The session is gone or busy in another agent process: the placeholder is all that is left.
    return false;
  }
  save();
  return true;
}
