import type { AgentJobEntry } from "../api/jobs.ts";
import { createState } from "./chat-state.ts";
import { applyAgentEvent } from "./turn-events.ts";
import type { AgentEvent, AgentTurn } from "./types.ts";

const FOLDED = new Set([
  "text",
  "thought",
  "tool",
  "tool-result",
  "task",
  "session",
  "context",
  "usage",
]);

/**
 * The journal of a job as one answer of the agent: the same events the chat folds into its turns,
 * so the job reads exactly like a chat. Requests that wait are shown by the job itself, answers
 * given to them stay in the text as notes.
 */
export function jobTurn(journal: AgentJobEntry[], id: string, at: number): AgentTurn {
  const state = createState();
  const turn: AgentTurn = { id, role: "assistant", text: "", at, tools: [], parts: [] };
  for (const entry of journal) {
    if (FOLDED.has(entry.event))
      applyAgentEvent(
        state,
        turn,
        { event: entry.event, data: entry.data } as AgentEvent,
        () => {},
      );
    else if (entry.event === "answer") {
      const data = entry.data as { auto?: boolean; summary?: string; title?: string };
      turn.parts!.push({
        type: "note",
        text: data.auto
          ? `Разрешено автоматически: ${data.title ?? ""}`.trim()
          : `Ответ на запрос: ${data.summary ?? ""}`.trim(),
      });
    }
  }
  return turn;
}
