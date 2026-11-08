import { createReplay, type AgentCommand, type AgentEmitter } from "../../agent/index.ts";
import {
  createPlainDialect,
  isOver,
  type AcpCompaction,
  type AcpDialect,
  type AcpTaskPatch,
} from "./acp-dialect.ts";

interface ContentBlock {
  type?: string;
  text?: string;
}

/**
 * The slash commands of an `available_commands_update` (or of `session/new` in ACP v2) as the
 * chat knows them. The list is a full snapshot, so the caller replaces whatever it had.
 */
export function availableCommands(list: unknown): AgentCommand[] {
  const commands = Array.isArray(list) ? list : [];
  return commands.flatMap((item) => {
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
  });
}

/** ACP stop reasons are a short code; the chat shows a readable sentence. */
export function stopReasonError(stopReason: unknown): string {
  if (stopReason === "max_tokens") return "Достигнут лимит ответа агента";
  if (stopReason === "max_turn_requests") return "Достигнут лимит шагов агента";
  if (stopReason === "refusal") return "Агент отказался выполнять запрос";
  return "Агент завершился с ошибкой";
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
  // `content` is what the protocol asks clients to display; `rawOutput` is often only metadata
  // (a status, an exit code), so it is used when the update carries no readable content.
  const content = Array.isArray(update.content) ? update.content : [];
  const text = content
    .map((item) => {
      const block = item as {
        type?: string;
        content?: unknown;
        path?: unknown;
        oldText?: unknown;
        newText?: unknown;
      };
      if (block.type === "content") return contentText(block.content);
      if (block.type === "diff")
        return [
          String(block.path ?? ""),
          ...(typeof block.oldText === "string"
            ? block.oldText.split("\n").map((line) => `- ${line}`)
            : []),
          ...(typeof block.newText === "string"
            ? block.newText.split("\n").map((line) => `+ ${line}`)
            : []),
        ].join("\n");
      return "";
    })
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  if (typeof update.rawOutput === "string") return update.rawOutput;
  if (update.rawOutput != null) return JSON.stringify(update.rawOutput, null, 2);
  return "";
}

/**
 * Translates ACP `session/update` notifications into the chat's SSE events. Text chunks stream
 * into the answer; tool calls become chips that resolve on their `tool_call_update`.
 */
export function createAcpEventMapper(
  emit: AgentEmitter,
  label: string,
  dialect: AcpDialect = createPlainDialect(),
  options: {
    /** The run is a `/compact` command: its summary is the answer, not just a note. */
    compactCommand?: boolean;
  } = {},
) {
  let text = "";
  let model = "";
  const toolNames = new Map<string, string>();
  const emitTasks = (patches: AcpTaskPatch[]) => {
    for (const patch of patches) emit("task", patch);
  };
  /** A compaction took the context away: show its progress and keep its result in the chat. */
  function applyCompaction(compaction: AcpCompaction): void {
    const inputId = compaction.id ? `compaction:${compaction.id}` : undefined;
    const note = (message: string) =>
      emit("input", { text: message, ...(inputId ? { inputId } : {}) });
    // The compaction is over; the answer (or the next step of it) goes on from here.
    const done = () => emit("status", { phase: "thinking", provider: label, model });
    if (compaction.status === "started") {
      emit("status", { phase: "compacting" });
      return;
    }
    if (compaction.status === "completed") {
      const summary = compaction.summary?.trim();
      if (options.compactCommand) {
        const answer = summary || "Контекст сжат.";
        text += answer;
        emit("text", { text: answer });
      } else note("Контекст сжат");
      done();
      return;
    }
    if (compaction.status === "cancelled") {
      note("Сжатие контекста отменено");
      done();
      return;
    }
    note(
      compaction.error
        ? `Не удалось сжать контекст: ${compaction.error}`
        : "Не удалось сжать контекст",
    );
    done();
  }

  function finishTool(update: Record<string, unknown>, id: string, name: string): void {
    const output = dialect.output(id) || toolOutput(update);
    emitTasks(dialect.end(update, id, output));
    const shown = dialect.result(update, id, output);
    if (update.status === "failed")
      emit("tool-result", { id, name, error: shown || "Ошибка инструмента" });
    else emit("tool-result", { id, name, output: shown });
  }

  /** Output that arrives while the call still runs: the chat shows it as it comes. */
  function streamOutput(update: Record<string, unknown>, id: string): void {
    if (isOver(update)) return;
    const chunk = dialect.outputChunk(update);
    if (chunk) emit("tool-output", { id, chunk });
  }

  function handleUpdate(_sessionId: string, update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    const compaction = dialect.compaction(update);
    if (compaction) {
      applyCompaction(compaction);
      return;
    }
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
      emit("commands", { commands: availableCommands(update.availableCommands) });
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
    if (kind === "session_info_update") {
      const retry = dialect.retry(update);
      if (retry === null) emit("status", { phase: "thinking", provider: label, model });
      else if (retry)
        emit("status", {
          phase: "retrying",
          attempt: retry.attempt,
          ...(retry.delay !== undefined ? { delay: retry.delay } : {}),
          ...(retry.message ? { message: retry.message } : {}),
          provider: label,
          model,
        });
      return;
    }
    if (kind === "current_mode_update") {
      // Native title/mode live on the agent's session list; the chat keeps its own first-message title.
      return;
    }
    if (kind === "agent_thought_chunk") {
      emit("status", { phase: "thinking", provider: label, model });
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
        ...(typeof update.kind === "string" ? { kind: update.kind } : {}),
        ...(parent ? { parent } : {}),
      });
      emitTasks(dialect.call(update, id));
      streamOutput(update, id);
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
        emit("tool", {
          id,
          name,
          input,
          ...(typeof update.kind === "string" ? { kind: update.kind } : {}),
          ...(parent ? { parent } : {}),
        });
      }
      emitTasks(dialect.call(update, id));
      streamOutput(update, id);
      if (update.status === "completed" || update.status === "failed") finishTool(update, id, name);
    }
  }

  return {
    handleUpdate,
    /** The answer ended: commands still running will outlive it. */
    finish: () => emitTasks(dialect.finish()),
    setModel(name: string) {
      model = name;
    },
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
    const output = dialect.result(update, id, dialect.output(id) || toolOutput(update));
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
