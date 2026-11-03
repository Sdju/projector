import type { AgentCommandRequest } from "../model/types.ts";

/**
 * Answers a `command-request` of an agent by running the live Projector command in the page and
 * posting the result back. A request that arrives after the run ended is rejected by the server.
 */
export async function answerCommand(
  id: string,
  request: AgentCommandRequest,
  commands: ((request: AgentCommandRequest) => Promise<unknown>) | undefined,
  signal?: AbortSignal,
): Promise<void> {
  let result: { output?: unknown; error?: string };
  try {
    if (!commands) throw new Error("Команды недоступны в этом чате");
    result = { output: await commands(request) };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  const reply = await fetch("/api/agent/tool-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...result }),
    signal,
  });
  if (!reply.ok) throw new Error("Не удалось передать результат команды агенту");
}
