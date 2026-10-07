import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEmitter } from "./backend.ts";

export const CLAUDE_LABEL = "Claude Code";

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text")
        return String((part as { text?: unknown }).text ?? "");
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Translates Claude Code SDK messages into the chat's SSE events. Sub-agent output
 * (`parent_tool_use_id`) is shown as tool chips only, never as the answer text.
 */
export function createClaudeEventMapper(emit: AgentEmitter) {
  const toolNames = new Map<string, string>();
  const streamed = new Set<string>();
  let messageId = "";
  let text = "";
  let started = false;
  let failed = false;
  let sessionId = "";

  const write = (chunk: string) => {
    text += chunk;
    emit("text", { text: chunk });
  };

  function handle(message: SDKMessage): void {
    switch (message.type) {
      case "system": {
        if (message.subtype !== "init") return;
        sessionId = message.session_id;
        emit("session", { id: message.session_id, backend: "claude-code" });
        emit("status", {
          phase: "thinking",
          provider: CLAUDE_LABEL,
          model: message.model,
        });
        return;
      }
      case "stream_event": {
        if (message.parent_tool_use_id) return;
        const event = message.event;
        if (event.type === "message_start") {
          messageId = event.message.id;
          started = true;
          if (text && !text.endsWith("\n")) write("\n\n");
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text
        ) {
          streamed.add(messageId);
          write(event.delta.text);
        }
        return;
      }
      case "assistant": {
        started = true;
        const content = message.message.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === "tool_use") {
            if (toolNames.has(block.id)) continue;
            const name = block.name;
            toolNames.set(block.id, name);
            emit("tool", { id: block.id, name, input: block.input });
          } else if (
            block.type === "text" &&
            !message.parent_tool_use_id &&
            !streamed.has(message.message.id)
          ) {
            if (text && !text.endsWith("\n")) write("\n\n");
            write(block.text);
          }
        }
        return;
      }
      case "user": {
        const content = message.message.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type !== "tool_result") continue;
          const id = block.tool_use_id;
          const name = toolNames.get(id) ?? "tool";
          const output = flattenContent(block.content);
          if (block.is_error)
            emit("tool-result", { id, name, error: output || "Ошибка инструмента" });
          else emit("tool-result", { id, name, output });
        }
        return;
      }
      case "result": {
        if (message.subtype === "success" && !message.is_error) {
          emit("done", {
            text: (message.result || text).trim(),
            added: [],
            costUsd: message.total_cost_usd,
          });
        } else {
          failed = true;
          const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
          const reason =
            message.subtype === "success"
              ? message.result
              : message.subtype === "error_max_turns"
                ? "Достигнут лимит шагов Claude Code"
                : errors.join("\n");
          emit("error", { error: reason || "Claude Code завершился с ошибкой" });
        }
        return;
      }
      default:
        return;
    }
  }

  return {
    handle,
    /** No assistant output yet: the request failed before the model answered. */
    get started() {
      return started;
    },
    get failed() {
      return failed;
    },
    get sessionId() {
      return sessionId;
    },
  };
}
