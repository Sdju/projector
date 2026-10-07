import type { AgentEmitter } from "./backend.ts";

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
