import type { AgentTurn } from "./types.ts";

/** An answer saved at its start that never got its text, its run or its own session. */
export function interruptedAnswer(turn: AgentTurn | undefined, interrupted: string): boolean {
  return (
    turn?.role === "assistant" &&
    !turn.run &&
    !turn.failure &&
    !turn.stopped &&
    !turn.tools.length &&
    (!turn.text.trim() || turn.text === interrupted)
  );
}

/** The native session the chat goes on in: the last answer's; a detached chat has none. */
export function sessionIdOf(turns: AgentTurn[]): string | undefined {
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    if (turn.role !== "assistant") continue;
    if (turn.detached) return undefined;
    // An answer that lost its text never started a session of its own: the question went on in
    // the previous one, and only its id lets the chat continue or restore the answer.
    if (turn.session?.id) return turn.session.id;
  }
  return undefined;
}

/** The session the answer before `turn` continued; a detached chat has none. */
export function previousSession(turns: AgentTurn[], turn: AgentTurn): AgentTurn["session"] {
  const at = turns.lastIndexOf(turn);
  for (let index = (at < 0 ? turns.length : at) - 1; index >= 0; index--) {
    const item = turns[index]!;
    if (item.role !== "assistant") continue;
    if (item.detached) return undefined;
    if (item.session) return item.session;
  }
  return undefined;
}

/** Where the kept conversation ends in the agent's transcript (Claude Code branches from it). */
export function tailOf(turns: AgentTurn[]): string | undefined {
  return turns.findLast((item) => item.role === "assistant")?.tail;
}
