import { INTERRUPTED } from "./load-history.ts";
import type { AgentPart, AgentTurn } from "./types.ts";

/**
 * The last answer was cut off before its text reached the chat. Tool cards may already be saved:
 * they arrive before the final text and say nothing about whether it was received. A stopped
 * answer is intentionally incomplete, and a live one still has its run to rejoin.
 */
export function answerLost(turn: AgentTurn | undefined): boolean {
  return (
    turn?.role === "assistant" &&
    !turn.run &&
    !turn.stopped &&
    (!turn.text.trim() || turn.text === INTERRUPTED)
  );
}

/** What the agent's own harness adds to the transcript: reminders that belong to the same answer. */
const HARNESS = "<system-reminder>";

/**
 * Whether this transcript message is the question the chat lost. Agents put the Projector
 * instructions before the user's words (OpenCode) or append reminders after them (Kimi), so the
 * question is matched at either end, and inside a long message.
 */
function asks(text: string, question: string): boolean {
  const line = text.trim();
  return (
    line.startsWith(question) ||
    line.endsWith(question) ||
    (question.length >= 40 && line.includes(question))
  );
}

/** The answer to one question: every message before the next real message of the user. */
function answerTurns(native: AgentTurn[], asked: number): AgentTurn[] {
  const answer: AgentTurn[] = [];
  for (const turn of native.slice(asked + 1)) {
    if (turn.role === "user") {
      if (!turn.text.trim().startsWith(HARNESS)) break;
      continue;
    }
    answer.push(turn);
  }
  return answer;
}

/** Copies the answer into the lost turn: every message, call and thought in their order. */
function mergeAnswer(lost: AgentTurn, answer: AgentTurn[]): boolean {
  let text = "";
  const tools: AgentTurn["tools"] = [];
  const parts: AgentPart[] = [];
  const add = (part: AgentPart) => {
    const last = parts.at(-1);
    if (part.type === "text" && last?.type === "text")
      last.text += `${last.text.endsWith("\n\n") ? "" : "\n\n"}${part.text}`;
    else parts.push({ ...part });
  };
  for (const turn of answer) {
    if (turn.text.trim()) {
      if (text.trim() && !text.endsWith("\n\n")) text += "\n\n";
      text += turn.text;
    }
    tools.push(...turn.tools);
    if (turn.parts?.length) for (const part of turn.parts) add(part);
    else {
      if (turn.text) add({ type: "text", text: turn.text });
      for (const tool of turn.tools) add({ type: "tool", id: tool.id });
    }
  }
  if (!text.trim() && !tools.length) return false;
  lost.text = text;
  lost.tools = tools;
  lost.parts = parts;
  // The agent's own transcript has the answer: the earlier failure is not the last word.
  lost.failure = undefined;
  return true;
}

/**
 * Copies the answer the agent finished in its own session into the turn the chat lost. The
 * question names the answer in a continued session; harness reminders do not end it, and the
 * answer may arrive as several messages, which are merged back into one.
 */
export function restoreLostAnswer(turns: AgentTurn[], native: AgentTurn[]): boolean {
  const lost = turns.at(-1);
  if (!lost || lost.role !== "assistant" || !answerLost(lost)) return false;
  const question = turns.findLast((turn) => turn.role === "user")?.text.trim();
  if (!question) return false;
  const asked = native.findLastIndex((turn) => turn.role === "user" && asks(turn.text, question));
  if (asked < 0) return false;
  return mergeAnswer(lost, answerTurns(native, asked));
}

/**
 * Turns whose transcript was already read in this page. A tool-only answer stays text-less after
 * a successful merge, so without this guard every chat sync would load the whole session again.
 * A failed load is not remembered: the session may still be busy and become readable later.
 */
const attempted = new WeakSet<AgentTurn>();

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
  if (!turn?.session?.id || !answerLost(turn) || attempted.has(turn)) return false;
  let native: AgentTurn[];
  try {
    native = await load(turn.session.id);
  } catch {
    // The session is gone or busy in another agent process: try again when it is available.
    return false;
  }
  attempted.add(turn);
  if (!restoreLostAnswer(turns, native)) return false;
  save();
  return true;
}
