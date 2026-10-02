import type { AgentEvent, AgentHistoryTurn } from "../model/types.ts";

function parseSse(buffer: string): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const chunk of parts) {
    let name = "";
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!name) continue;
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join("\n") || "{}") } as AgentEvent);
    } catch {
      events.push({ event: "error", data: { error: "Некорректный поток" } });
    }
  }
  return { events, rest };
}

export async function streamAgent(
  message: string,
  history: AgentHistoryTurn[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Агент недоступен");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  if (buffer.trim()) {
    const parsed = parseSse(`${buffer}\n\n`);
    for (const event of parsed.events) onEvent(event);
  }
}
