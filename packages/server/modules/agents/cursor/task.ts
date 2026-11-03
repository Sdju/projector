import type { AgentRunOptions } from "../../agent/index.ts";

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

function subagentOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && value !== "unspecified") return value;
  if (value && typeof value === "object" && "custom" in value) {
    const custom = (value as { custom?: unknown }).custom;
    if (typeof custom === "string" && custom.trim()) return custom;
  }
  return undefined;
}

/** `cursor/task`: the subagent finished; the dialect already opened the task on the tool call. */
export async function reportCursorTask(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const id = text(params.toolCallId, 200);
  if (!id) return {};
  const subagent = subagentOf(params.subagentType);
  const title = text(params.description, 500) || subagent || "задача";
  const prompt = text(params.prompt, 2000);
  const duration = typeof params.durationMs === "number" ? params.durationMs : undefined;
  options.emit("task", {
    id,
    kind: "agent",
    title,
    status: "done",
    background: false,
    ...(subagent ? { subagent } : {}),
    ...(prompt ? { prompt } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
  });
  return {};
}
