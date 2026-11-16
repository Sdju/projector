import type { AgentJobEntry } from "../../../../agent-core/index.ts";
import { createState } from "../../../../agent-core/index.ts";
import { applyAgentEvent } from "../../../../agent-core/index.ts";
import type { AgentEvent, AgentTurn } from "../../../../agent-core/index.ts";

const FOLDED = new Set([
  "text",
  "thought",
  "tool",
  "tool-output",
  "tool-result",
  "judge",
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
  // A permission answered through the judge card reads as that card's note; the plain answer
  // note would repeat it.
  const judged = journal.some(
    (entry) =>
      entry.event === "judge" &&
      (entry.data as { decision?: unknown } | undefined)?.decision !== "auto",
  );
  for (const entry of journal) {
    if (FOLDED.has(entry.event))
      applyAgentEvent(
        state,
        turn,
        { event: entry.event, data: entry.data } as AgentEvent,
        () => {},
        entry.at,
      );
    else if (entry.event === "answer") {
      const data = entry.data as {
        auto?: boolean;
        kind?: string;
        summary?: string;
        title?: string;
      };
      if (data.kind === "permission" && judged) continue;
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
