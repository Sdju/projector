import type { AgentSessionTurn } from "./controls.ts";

/**
 * Collects the turns of a past session in the shape live answers have: text, reasoning and tool
 * calls in the order they happened, so a reopened chat reads like the one that was watched.
 */
export function createReplay(backend: string, sessionId: string) {
  const turns: AgentSessionTurn[] = [];
  let counter = 0;
  let at: number | undefined;

  const turnFor = (role: "user" | "assistant"): AgentSessionTurn => {
    const last = turns.at(-1);
    if (last?.role === role) return last;
    const turn: AgentSessionTurn = {
      id: `replay-${++counter}`,
      role,
      text: "",
      tools: [],
      ...(at ? { at } : {}),
      ...(role === "assistant" ? { session: { backend, id: sessionId }, parts: [] } : {}),
    };
    turns.push(turn);
    return turn;
  };

  return {
    turnFor,
    /** The time of the messages that follow; a turn they open is stamped with it. */
    mark(time: number | undefined) {
      at = time;
    },
    user(text: string) {
      turnFor("user").text += text;
    },
    text(text: string) {
      if (!text) return;
      const turn = turnFor("assistant");
      const parts = (turn.parts ??= []);
      const last = parts.at(-1);
      // Like a live answer: text that follows a finished message starts a new paragraph.
      if (last?.type === "text") {
        const gap = turn.text && !turn.text.endsWith("\n") ? "\n\n" : "";
        last.text += gap + text;
        turn.text += gap + text;
      } else {
        if (turn.text.trim() && !turn.text.endsWith("\n\n")) turn.text += "\n\n";
        parts.push({ type: "text", text });
        turn.text += text;
      }
    },
    thought(text: string) {
      const parts = (turnFor("assistant").parts ??= []);
      const last = parts.at(-1);
      if (last?.type === "thought") last.text += text;
      else parts.push({ type: "thought", text });
    },
    /** A line between messages that is not the agent's own words (the context was compacted). */
    note(text: string) {
      (turnFor("assistant").parts ??= []).push({ type: "note", text });
    },
    tool(tool: AgentSessionTurn["tools"][number]) {
      const turn = turnFor("assistant");
      turn.tools.push(tool);
      (turn.parts ??= []).push({ type: "tool", id: tool.id });
    },
    findTool(id: string) {
      return turns.flatMap((turn) => turn.tools).find((item) => item.id === id);
    },
    /** Turns with something to show; empty chunks the agent sends between messages are dropped. */
    get turns() {
      return turns.filter(
        (turn) =>
          turn.text.trim() ||
          turn.tools.length ||
          turn.tasks?.length ||
          turn.parts?.some((part) => part.type === "note" || part.type === "thought"),
      );
    },
    /** Every task of the session, to update from a later report. */
    get allTurns() {
      return turns;
    },
  };
}
