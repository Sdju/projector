import type { AgentEmitter } from "./backend.ts";
import type { AgentSessionTurn } from "./controls.ts";

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
export function createAcpEventMapper(emit: AgentEmitter, label: string) {
  let text = "";
  const toolNames = new Map<string, string>();

  function finishTool(update: Record<string, unknown>, id: string, name: string): void {
    const output = toolOutput(update);
    if (update.status === "failed")
      emit("tool-result", { id, name, error: output || "Ошибка инструмента" });
    else emit("tool-result", { id, name, output });
  }

  function handleUpdate(_sessionId: string, update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const chunk = contentText(update.content);
      if (!chunk) return;
      text += chunk;
      emit("text", { text: chunk });
      return;
    }
    if (kind === "agent_thought_chunk") {
      emit("status", { phase: "thinking", provider: label, model: "" });
      return;
    }
    if (kind === "tool_call") {
      const id = String(update.toolCallId ?? "");
      if (!id) return;
      const name = String(update.title || update.kind || "tool");
      toolNames.set(id, name);
      emit("tool", {
        id,
        name,
        input: update.rawInput ?? { title: update.title, kind: update.kind },
      });
      if (update.status === "completed" || update.status === "failed") finishTool(update, id, name);
      return;
    }
    if (kind === "tool_call_update") {
      const id = String(update.toolCallId ?? "");
      const name = toolNames.get(id) ?? String(update.title || "tool");
      if (update.status === "completed" || update.status === "failed") finishTool(update, id, name);
    }
  }

  return {
    handleUpdate,
    get text() {
      return text;
    },
  };
}

/**
 * Rebuilds the chat from the updates an agent replays on `session/load`: user and agent message
 * chunks become turns, tool calls become the chips of the answer they belong to.
 */
export function createAcpReplayCollector(backend: string, sessionId: string) {
  const turns: AgentSessionTurn[] = [];
  let counter = 0;
  const turnFor = (role: "user" | "assistant"): AgentSessionTurn => {
    const last = turns.at(-1);
    if (last?.role === role) return last;
    const turn: AgentSessionTurn = {
      id: `replay-${++counter}`,
      role,
      text: "",
      tools: [],
      ...(role === "assistant" ? { session: { backend, id: sessionId } } : {}),
    };
    turns.push(turn);
    return turn;
  };

  function handleUpdate(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (kind === "user_message_chunk") turnFor("user").text += contentText(update.content);
    else if (kind === "agent_message_chunk")
      turnFor("assistant").text += contentText(update.content);
    else if (kind === "tool_call") {
      const id = String(update.toolCallId ?? "");
      if (!id) return;
      turnFor("assistant").tools.push({
        id,
        name: String(update.title || update.kind || "tool"),
        status: "running",
        detail: toolDetail(update.rawInput),
      });
      finish(update, id);
    } else if (kind === "tool_call_update") {
      const id = String(update.toolCallId ?? "");
      if (id) finish(update, id);
    }
  }

  function finish(update: Record<string, unknown>, id: string): void {
    if (update.status !== "completed" && update.status !== "failed") return;
    const chip = turns.flatMap((turn) => turn.tools).find((item) => item.id === id);
    if (!chip) return;
    chip.status = update.status === "failed" ? "error" : "done";
    const output = toolOutput(update);
    if (output) chip.detail = output.slice(0, 8000);
  }

  return {
    handleUpdate,
    /** Turns with text or tools; empty chunks the agent sends between messages are dropped. */
    get turns() {
      return turns.filter((turn) => turn.text.trim() || turn.tools.length);
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
