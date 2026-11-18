import { stripReadLineNumbers } from "@ai-projector/core/modules/agent-read/index.ts";
import { kimiBackgroundState } from "./background-state.ts";
import {
  extendPlainDialect,
  inputOf,
  shorten,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "../acp/index.ts";

/** A call that reads a file: its result is a numbered file body, not raw tool text. */
const readsFile = (update: AcpUpdate) =>
  update.kind === "read" || (typeof update.title === "string" && /^Reading\b/i.test(update.title));

/** Kimi's `Agent` tool: title is usually `Agent`, input carries the subagent fields. */
function agentInput(update: AcpUpdate) {
  const input = inputOf(update);
  const titled = update.title === "Agent";
  const background = input.run_in_background === true;
  const subagent =
    typeof input.subagent_type === "string"
      ? input.subagent_type
      : typeof input.resume === "string"
        ? "resume"
        : undefined;
  if (!titled && !background && subagent === undefined) return undefined;
  return {
    background,
    description:
      typeof input.description === "string" && input.description
        ? input.description
        : typeof input.resume === "string"
          ? `Resume ${input.resume}`
          : "Agent",
    ...(subagent ? { subagent } : {}),
    ...(typeof input.prompt === "string" && input.prompt ? { prompt: input.prompt } : {}),
    ...(typeof input.resume === "string" ? { resume: input.resume } : {}),
  };
}

/** Fields shared by Agent tool receipts (`status: running|completed|failed|lost|…`). */
function agentReceipt(output: string) {
  const status = /(?:^|\n)status:\s*(\S+)/i.exec(output)?.[1]?.toLowerCase();
  if (!status) return undefined;
  const agentId = /(?:^|\n)agent_id:\s*(\S+)/i.exec(output)?.[1];
  const taskId = /(?:^|\n)task_id:\s*(\S+)/i.exec(output)?.[1];
  const subagent = /(?:^|\n)actual_subagent_type:\s*(\S+)/i.exec(output)?.[1];
  const description = /(?:^|\n)description:\s*(.+)/i.exec(output)?.[1]?.trim();
  return {
    status,
    ...(agentId ? { session: agentId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(subagent ? { subagent } : {}),
    ...(description ? { description } : {}),
  };
}

/** Map Kimi Agent receipt status onto a chat task status. */
function taskStatusOf(status: string): "running" | "done" | "error" | "stopped" | undefined {
  if (status === "running") return "running";
  if (status === "completed" || status === "done") return "done";
  if (status === "failed" || status === "error" || status === "timed_out") return "error";
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

/** Kimi can ask permission after end_turn; its local task records provide the final status. */
export function createKimiDialect(readTask = kimiBackgroundState()): AcpDialect {
  const reads = new Set<string>();
  const open = new Map<string, { background: boolean; description: string }>();
  const background = new Map<string, { taskId: string; deadline: number }>();

  return extendPlainDialect({
    call(update, id) {
      if (readsFile(update)) reads.add(id);
      const agent = agentInput(update);
      if (!agent || open.has(id)) return [];
      open.set(id, { background: agent.background, description: agent.description });
      const patch: AcpTaskPatch = {
        id,
        kind: "agent",
        title: agent.description,
        status: "running",
        background: agent.background,
        ...(agent.subagent && agent.subagent !== "resume" ? { subagent: agent.subagent } : {}),
        ...(agent.prompt ? { prompt: agent.prompt } : {}),
        ...(agent.resume ? { session: agent.resume } : {}),
        tool: id,
      };
      return [patch];
    },
    result(_update, id, output) {
      return reads.has(id) ? stripReadLineNumbers(output) : output;
    },
    end(update, id, output) {
      const known = open.get(id);
      if (!known) return [];
      const receipt = agentReceipt(output);
      const fromReceipt = receipt ? taskStatusOf(receipt.status) : undefined;
      if (fromReceipt === "running") {
        if (receipt?.taskId)
          background.set(id, { taskId: receipt.taskId, deadline: Date.now() + 121 * 60_000 });
        return [
          {
            id,
            kind: "agent",
            title: receipt?.description ?? known.description,
            status: "running",
            background: true,
            ...(!receipt?.taskId ? { hold: false } : {}),
            ...(receipt?.subagent ? { subagent: receipt.subagent } : {}),
            ...(receipt?.session ? { session: receipt.session } : {}),
            ...(shorten(output) ? { summary: shorten(receipt?.description ?? output) } : {}),
            tool: id,
          },
        ];
      }
      open.delete(id);
      background.delete(id);
      const summary = shorten(output);
      const status = fromReceipt ?? (update.status === "failed" ? "error" : ("done" as const));
      return [
        {
          id,
          status,
          background: known.background,
          ...(receipt?.subagent ? { subagent: receipt.subagent } : {}),
          ...(receipt?.session ? { session: receipt.session } : {}),
          ...(summary ? { summary } : {}),
          ...(known.background || fromReceipt ? { tool: id } : {}),
        },
      ];
    },
    poll(sessionId) {
      const patches: AcpTaskPatch[] = [];
      for (const [id, { taskId, deadline }] of background) {
        const record = readTask(sessionId, taskId);
        const status = record && taskStatusOf(record.status);
        if (status && status !== "running") {
          patches.push({ id, status, ...(record?.endedAt ? { endedAt: record.endedAt } : {}) });
        } else if (Date.now() >= deadline) {
          patches.push({ id, status: "error", summary: "Kimi не записал итог фоновой задачи" });
        } else continue;
        background.delete(id);
        open.delete(id);
      }
      return patches;
    },
  });
}
