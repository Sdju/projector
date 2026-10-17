import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTask, AgentTaskPatch } from "../../../../core/modules/agent-task/index.ts";
import type { AgentEmitter } from "../../agent/index.ts";

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

function taskStatus(status: string): AgentTask["status"] {
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  if (status === "killed") return "stopped";
  return "running";
}

/**
 * Translates Claude Code SDK messages into the chat's SSE events. Sub-agent output
 * (`parent_tool_use_id`) is shown as tool chips only, never as the answer text.
 */
export function createClaudeEventMapper(emit: AgentEmitter) {
  const toolNames = new Map<string, string>();
  const streamed = new Set<string>();
  const thoughtStreamed = new Set<string>();
  let messageId = "";
  let text = "";
  let started = false;
  let failed = false;
  let sessionId = "";

  const write = (chunk: string) => {
    text += chunk;
    emit("text", { text: chunk });
  };

  /** Subagents and background commands: each system message patches one row of the task panel. */
  function handleTask(message: SDKMessage & { type: "system" }) {
    const task = (patch: AgentTaskPatch) => emit("task", patch);
    switch (message.subtype) {
      case "task_started":
        if (message.skip_transcript || message.ambient) return;
        task({
          id: message.task_id,
          kind:
            message.task_type === "local_bash"
              ? "shell"
              : message.subagent_type || message.task_type === "local_agent"
                ? "agent"
                : "other",
          title: message.description,
          status: "running",
          background: message.is_backgrounded === true,
          ...(message.subagent_type ? { subagent: message.subagent_type } : {}),
          ...(message.prompt ? { prompt: message.prompt } : {}),
          ...(message.tool_use_id ? { tool: message.tool_use_id } : {}),
        });
        return;
      case "task_progress":
        task({
          id: message.task_id,
          title: message.description,
          ...(message.summary ? { summary: message.summary } : {}),
          ...(message.last_tool_name ? { lastTool: message.last_tool_name } : {}),
          tools: message.usage.tool_uses,
          tokens: message.usage.total_tokens,
          durationMs: message.usage.duration_ms,
        });
        return;
      case "task_updated": {
        const { status, description, is_backgrounded: background, error } = message.patch;
        task({
          id: message.task_id,
          ...(status ? { status: taskStatus(status) } : {}),
          ...(description ? { title: description } : {}),
          ...(background === undefined ? {} : { background }),
          ...(error ? { summary: error } : {}),
        });
        return;
      }
      case "task_notification":
        if (message.skip_transcript || message.ambient) return;
        task({
          id: message.task_id,
          status:
            message.status === "completed"
              ? "done"
              : message.status === "failed"
                ? "error"
                : "stopped",
          ...(message.summary ? { summary: message.summary } : {}),
          ...(message.usage
            ? {
                tools: message.usage.tool_uses,
                tokens: message.usage.total_tokens,
                durationMs: message.usage.duration_ms,
              }
            : {}),
        });
        return;
      default:
        return;
    }
  }

  function handle(message: SDKMessage): void {
    switch (message.type) {
      case "system": {
        if (message.subtype !== "init") {
          handleTask(message);
          return;
        }
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
          event.delta.type === "thinking_delta" &&
          event.delta.thinking
        ) {
          thoughtStreamed.add(messageId);
          emit("thought", { text: event.delta.thinking });
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
            emit("tool", {
              id: block.id,
              name,
              input: block.input,
              ...(message.parent_tool_use_id ? { parent: message.parent_tool_use_id } : {}),
            });
          } else if (
            block.type === "thinking" &&
            block.thinking &&
            !message.parent_tool_use_id &&
            !thoughtStreamed.has(message.message.id)
          ) {
            emit("thought", { text: block.thinking });
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
