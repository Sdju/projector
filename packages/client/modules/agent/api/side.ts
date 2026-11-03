import type {
  AgentCommandRequest,
  AgentHistoryTurn,
  AgentSelection,
  AgentSideEvent,
  AgentSideExchange,
  AgentSidePlanItem,
  AgentSideRunningTool,
} from "../model/types.ts";
import { answerCommand } from "./commands.ts";
import { parseSse } from "./sse.ts";

export interface SideAskOptions {
  projectId: string;
  chat: string;
  /** The chat's agent; the side answer still comes from Projector, the field is for diagnostics. */
  backend?: string;
  selection?: AgentSelection;
  thread: AgentSideExchange[];
  running: AgentSideRunningTool[];
  plan: AgentSidePlanItem[];
  commands?: (request: AgentCommandRequest) => Promise<unknown>;
  signal?: AbortSignal;
}

/**
 * Asks a side question. It is a plain request with its own stream: no run record, no events
 * stream of the page and no rejoin. Closing the panel aborts only this request.
 */
export async function streamSide(
  question: string,
  history: AgentHistoryTurn[],
  options: SideAskOptions,
  onEvent: (event: AgentSideEvent) => void,
): Promise<void> {
  const response = await fetch("/api/agent/side", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history,
      projectId: options.projectId,
      chat: options.chat,
      backend: options.backend,
      selection: options.selection,
      thread: options.thread,
      running: options.running,
      plan: options.plan,
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Вопрос в сторону недоступен");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = async (event: AgentSideEvent) => {
    if (event.event !== "command-request") return onEvent(event);
    await answerCommand(event.data.id, event.data, options.commands, options.signal);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) await handle(event as AgentSideEvent);
  }
  if (buffer.trim()) {
    const parsed = parseSse(`${buffer}\n\n`);
    for (const event of parsed.events) await handle(event as AgentSideEvent);
  }
}
