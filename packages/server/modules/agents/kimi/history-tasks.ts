import type { AgentTask } from "@ai-projector/core/modules/agent-task/index.ts";

type HistoryTool = { id: string; name: string; status: string; detail?: string };
/** Loose shape so `StoredTurn[]` from history can be hydrated without a cast. */
export type KimiHistoryTurn = {
  role?: string;
  text?: string;
  tools?: HistoryTool[];
  tasks?: AgentTask[];
  variants?: KimiHistoryTurn[][];
};

/** Fields shared by Agent tool receipts (`status: running|completed|failed|lost|…`). */
function agentReceipt(output: string) {
  const status = /(?:^|\n)status:\s*(\S+)/i.exec(output)?.[1]?.toLowerCase();
  if (!status) return undefined;
  const agentId = /(?:^|\n)agent_id:\s*(\S+)/i.exec(output)?.[1];
  const subagent = /(?:^|\n)actual_subagent_type:\s*(\S+)/i.exec(output)?.[1];
  const description = /(?:^|\n)description:\s*(.+)/i.exec(output)?.[1]?.trim();
  return {
    status,
    ...(agentId ? { session: agentId } : {}),
    ...(subagent ? { subagent } : {}),
    ...(description ? { description } : {}),
  };
}

function taskStatusOf(status: string): AgentTask["status"] | undefined {
  if (status === "running") return "running";
  if (status === "completed" || status === "done") return "done";
  if (status === "failed" || status === "error") return "error";
  if (
    status === "lost" ||
    status === "killed" ||
    status === "cancelled" ||
    status === "terminated"
  ) {
    return "stopped";
  }
  return undefined;
}

function titleFromDetail(detail: string): string | undefined {
  try {
    const parsed = JSON.parse(detail) as { description?: unknown };
    if (typeof parsed.description === "string" && parsed.description) return parsed.description;
  } catch {
    /* receipt prose, not JSON input */
  }
  return undefined;
}

/**
 * Older Kimi replays stored Agent tool chips without `tasks[]`. Rebuild background agent rows
 * from receipts so the chat island and lost-contact sanitize have something to update.
 */
export function hydrateKimiHistoryTasks(turns: KimiHistoryTurn[]): boolean {
  let changed = false;
  const walk = (list: KimiHistoryTurn[]) => {
    for (const turn of list) {
      if (turn.role === "assistant") {
        const tools = turn.tools ?? [];
        const tasks = (turn.tasks ??= []);
        for (const tool of tools) {
          if (tool.name !== "Agent") continue;
          if (tasks.some((item) => item.id === tool.id || item.tool === tool.id)) continue;
          const detail = tool.detail ?? "";
          const receipt = agentReceipt(detail);
          const fromReceipt = receipt ? taskStatusOf(receipt.status) : undefined;
          const title = receipt?.description ?? titleFromDetail(detail) ?? "Agent";
          const background = fromReceipt === "running" || /run_in_background/i.test(detail);
          tasks.push({
            id: tool.id,
            kind: "agent",
            title,
            status: fromReceipt ?? (tool.status === "error" ? "error" : "done"),
            background,
            ...(background ? { hold: false } : {}),
            ...(receipt?.session ? { session: receipt.session } : {}),
            ...(receipt?.subagent ? { subagent: receipt.subagent } : {}),
            tool: tool.id,
          });
          changed = true;
        }
      }
      for (const version of turn.variants ?? []) walk(version);
    }
  };
  walk(turns);
  return changed;
}
