import type { AgentEvent } from "../model/types.ts";

/** Parses the SSE events of an agent answer, keeping the unfinished tail for the next chunk. */
export function parseSse(buffer: string): { events: AgentEvent[]; rest: string } {
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
