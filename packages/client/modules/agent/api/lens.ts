import type { AgentHistoryTurn, AgentSelection } from "../model/types.ts";

/** What the page reports about the chat; the same facts the work block shows. */
export interface LensStateReport {
  busy: boolean;
  phase?: string;
  running: { name: string; input?: string; startedAt?: number }[];
  plan: { content: string; status: string }[];
  queue: number;
}

export interface LensAnswer {
  text: string;
  /** When the answer was written (ms since the epoch). */
  at: number;
}

/**
 * Asks for a caption of the current work. A plain request of its own: no run record, no history,
 * nothing written anywhere. Closing the panel aborts only this request.
 */
export async function fetchLens(
  input: {
    history: AgentHistoryTurn[];
    state: LensStateReport;
    selection?: AgentSelection;
  },
  signal?: AbortSignal,
): Promise<LensAnswer> {
  const response = await fetch("/api/agent/lens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as Partial<LensAnswer> & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "Lens недоступен");
  if (typeof data.text !== "string" || !data.text.trim())
    throw new Error("Lens не вернул описание");
  return { text: data.text.trim(), at: typeof data.at === "number" ? data.at : Date.now() };
}
