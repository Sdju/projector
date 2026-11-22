import { createReplay, sanitizeHarnessTurns } from "../../agent/index.ts";
import { createPlainDialect, type AcpDialect, type AcpTaskPatch } from "./acp-dialect.ts";

import { contentText, toolOutput } from "./acp-content.ts";

function toolDetail(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, 8000);
  try {
    return JSON.stringify(input, null, 2).slice(0, 8000);
  } catch {
    return "";
  }
}

/**
 * Rebuilds the chat from the updates an agent replays on `session/load`: user and agent message
 * chunks become turns, tool calls become the chips of the answer they belong to.
 */
export function createAcpReplayCollector(
  backend: string,
  sessionId: string,
  dialect: AcpDialect = createPlainDialect(),
) {
  const replay = createReplay(backend, sessionId);

  function applyTasks(patches: AcpTaskPatch[]) {
    if (!patches.length) return;
    const turn = replay.turnFor("assistant");
    const tasks = (turn.tasks ??= []);
    for (const patch of patches) {
      const known = tasks.find((item) => item.id === patch.id);
      if (known) Object.assign(known, patch);
      else
        tasks.push({
          kind: "other",
          title: "",
          status: "running",
          background: false,
          ...patch,
        });
    }
  }

  function handleUpdate(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    const call = typeof update.toolCallId === "string" ? update.toolCallId : "";
    const compaction = dialect.compaction(update);
    if (compaction) {
      if (compaction.status === "completed") replay.note("Контекст сжат");
      else if (compaction.status === "failed")
        replay.note(
          compaction.error
            ? `Не удалось сжать контекст: ${compaction.error}`
            : "Не удалось сжать контекст",
        );
      return;
    }
    if (kind === "user_message_chunk" || kind === "agent_message_chunk")
      replay.mark(dialect.time(update));
    if (kind === "user_message_chunk") replay.user(contentText(update.content));
    else if (kind === "agent_message_chunk") {
      const chunk = contentText(update.content);
      // A failure the agent printed into the stream was never an answer; history drops it too.
      if (dialect.streamError?.(update, chunk)) return;
      if (!dialect.chunk(update, chunk)) replay.text(chunk);
    } else if (kind === "agent_thought_chunk") {
      const chunk = contentText(update.content);
      if (chunk) replay.thought(chunk);
    } else if (kind === "tool_call") {
      if (!call) return;
      const { name, parent } = dialect.tool(update);
      replay.tool({
        id: call,
        name,
        status: "running",
        detail: toolDetail(update.rawInput),
        ...(parent ? { parent } : {}),
      });
      applyTasks(dialect.call(update, call));
      finish(update, call);
    } else if (kind === "tool_call_update") {
      if (!call) return;
      applyTasks(dialect.call(update, call));
      finish(update, call);
    }
  }

  function finish(update: Record<string, unknown>, id: string): void {
    if (update.status !== "completed" && update.status !== "failed") return;
    const chip = replay.findTool(id);
    if (!chip) return;
    chip.status = update.status === "failed" ? "error" : "done";
    const output = dialect.result(update, id, dialect.output(id) || toolOutput(update));
    if (output) chip.detail = output.slice(0, 8000);
    applyTasks(dialect.end(update, id, output));
  }

  return {
    handleUpdate,
    get turns() {
      const turns = replay.turns;
      sanitizeHarnessTurns(turns);
      return turns;
    },
  };
}
