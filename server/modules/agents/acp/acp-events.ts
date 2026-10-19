import { createReplay, type AgentEmitter } from "../../agent/index.ts";
import { createPlainDialect, type AcpDialect, type AcpTaskPatch } from "./acp-dialect.ts";

interface ContentBlock {
  type?: string;
  text?: string;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (part as ContentBlock | null)?.text ?? "")
      .filter(Boolean)
      .join("");
  const block = content as ContentBlock | null;
  return typeof block?.text === "string" ? block.text : "";
}

function toolOutput(update: Record<string, unknown>): string {
  if (typeof update.rawOutput === "string") return update.rawOutput;
  if (update.rawOutput != null) return JSON.stringify(update.rawOutput, null, 2);
  const content = Array.isArray(update.content) ? update.content : [];
  return content
    .map((item) => {
      const block = item as { type?: string; content?: unknown; path?: unknown };
      if (block.type === "content") return contentText(block.content);
      if (block.type === "diff") return `diff: ${String(block.path ?? "")}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Translates ACP `session/update` notifications into the chat's SSE events. Text chunks stream
 * into the answer; tool calls become chips that resolve on their `tool_call_update`.
 */
export function createAcpEventMapper(
  emit: AgentEmitter,
  label: string,
  dialect: AcpDialect = createPlainDialect(),
) {
  let text = "";
  const toolNames = new Map<string, string>();
  const emitTasks = (patches: AcpTaskPatch[]) => {
    for (const patch of patches) emit("task", patch);
  };

  function finishTool(update: Record<string, unknown>, id: string, name: string): void {
    const output = dialect.output(id) || toolOutput(update);
    emitTasks(dialect.end(update, id, output));
    if (update.status === "failed")
      emit("tool-result", { id, name, error: output || "Ошибка инструмента" });
    else emit("tool-result", { id, name, output });
  }

  function handleUpdate(_sessionId: string, update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const chunk = contentText(update.content);
      if (!chunk) return;
      // What a subagent says is its progress, not part of the answer.
      const progress = dialect.chunk(update, chunk);
      if (progress) {
        emitTasks(progress);
        return;
      }
      emitTasks(dialect.speak());
      text += chunk;
      emit("text", { text: chunk });
      return;
    }
    if (kind === "available_commands_update") {
      const list = Array.isArray(update.availableCommands) ? update.availableCommands : [];
      emit("commands", {
        commands: list.flatMap((item) => {
          const { name, description, input } = item as {
            name?: unknown;
            description?: unknown;
            input?: { hint?: unknown } | null;
          };
          if (typeof name !== "string" || !name) return [];
          return [
            {
              name,
              ...(typeof description === "string" && description ? { description } : {}),
              ...(typeof input?.hint === "string" ? { hint: input.hint } : {}),
            },
          ];
        }),
      });
      return;
    }
    if (kind === "usage_update") {
      const { used, size, cost } = update as { used?: unknown; size?: unknown; cost?: unknown };
      if (typeof used === "number" && typeof size === "number" && size > 0) {
        const { amount, currency } = (cost ?? {}) as { amount?: unknown; currency?: unknown };
        emit("context", {
          used,
          size,
          ...(typeof amount === "number" && typeof currency === "string"
            ? { cost: { amount, currency } }
            : {}),
        });
      }
      return;
    }
    if (kind === "agent_thought_chunk") {
      emit("status", { phase: "thinking", provider: label, model: "" });
      // A subagent's reasoning is not the answer's.
      const thought = contentText(update.content);
      if (thought && !dialect.inner(update)) emit("thought", { text: thought });
      return;
    }
    if (kind === "tool_call") {
      const id = String(update.toolCallId ?? "");
      if (!id) return;
      const { name, parent } = dialect.tool(update);
      toolNames.set(id, name);
      emit("tool", {
        id,
        name,
        input:
          update.rawInput && Object.keys(update.rawInput).length
            ? update.rawInput
            : { title: update.title, kind: update.kind },
        ...(parent ? { parent } : {}),
      });
      emitTasks(dialect.call(update, id));
      if (update.status === "completed" || update.status === "failed") finishTool(update, id, name);
      return;
    }
    if (kind === "tool_call_update") {
      const id = String(update.toolCallId ?? "");
      const name = toolNames.get(id) ?? String(update.title || "tool");
      // The input often completes after the call began: show it once it is there.
      const input = update.rawInput;
      if (input && typeof input === "object" && Object.keys(input).length) {
        const { parent } = dialect.tool(update);
        emit("tool", { id, name, input, ...(parent ? { parent } : {}) });
      }
      emitTasks(dialect.call(update, id));
      if (update.status === "completed" || update.status === "failed") finishTool(update, id, name);
    }
  }

  return {
    handleUpdate,
    /** The answer ended: commands still running will outlive it. */
    finish: () => emitTasks(dialect.finish()),
    get text() {
      return text;
    },
  };
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

  function handleUpdate(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    const call = String(update.toolCallId ?? "");
    if (kind === "user_message_chunk" || kind === "agent_message_chunk")
      replay.mark(dialect.time(update));
    if (kind === "user_message_chunk") replay.user(contentText(update.content));
    else if (kind === "agent_message_chunk") {
      const chunk = contentText(update.content);
      // The dialect keeps what a subagent said out of the answer.
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
      dialect.call(update, call);
      finish(update, call);
    } else if (kind === "tool_call_update") {
      if (!call) return;
      dialect.call(update, call);
      finish(update, call);
    }
  }

  function finish(update: Record<string, unknown>, id: string): void {
    if (update.status !== "completed" && update.status !== "failed") return;
    const chip = replay.findTool(id);
    if (!chip) return;
    chip.status = update.status === "failed" ? "error" : "done";
    const output = dialect.output(id) || toolOutput(update);
    if (output) chip.detail = output.slice(0, 8000);
  }

  return {
    handleUpdate,
    get turns() {
      return replay.turns;
    },
  };
}

function toolDetail(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, 8000);
  try {
    return JSON.stringify(input, null, 2).slice(0, 8000);
  } catch {
    return "";
  }
}
