import type { Project } from "../../project/index.ts";
import { formatToolInput } from "../lib/tool-input.ts";
import { summarize, type ChatState } from "./chat-state.ts";
import type { AgentEvent, AgentPart, AgentTurn } from "./types.ts";

/** Parts of a turn: the saved order, or text after tools for turns saved without one. */
export function legacyParts(turn: AgentTurn): AgentPart[] {
  return [
    ...turn.tools.map((tool) => ({ type: "tool" as const, id: tool.id })),
    ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
  ];
}

function appendText(turn: AgentTurn, text: string) {
  const parts = (turn.parts ??= legacyParts({ ...turn, text: turn.text.slice(0, -text.length) }));
  const last = parts.at(-1);
  if (last?.type === "text") last.text += text;
  else parts.push({ type: "text", text });
}

/**
 * Folds one stream event into the chat and the answer being written. Returns `true` when the
 * history should be saved now: a new session or run is what lets a reload resume the turn.
 */
export function applyAgentEvent(
  state: ChatState,
  assistant: AgentTurn,
  event: AgentEvent,
  ingest: (project: Project) => void,
): boolean {
  switch (event.event) {
    case "status":
      state.phase = event.data.model
        ? `${event.data.provider ?? "qwen"} · ${event.data.model}`
        : "думает";
      return false;
    case "run":
      assistant.run = event.data.id;
      return true;
    case "session":
      assistant.session = event.data;
      return true;
    case "controls":
      // What the agent really applied wins over a choice it refused.
      state.controls = event.data.controls;
      state.selection = {
        ...state.selection,
        ...Object.fromEntries(event.data.controls.map((item) => [item.id, item.current])),
      };
      return false;
    case "context":
      assistant.context = event.data;
      return false;
    case "permission-request":
      state.permissions.push({
        id: event.data.id,
        tool: event.data.tool,
        title: event.data.title || event.data.tool,
        detail:
          event.data.detail?.trim() ||
          formatToolInput(event.data.tool, summarize(event.data.input)),
        persistent: event.data.persistent === true,
      });
      return false;
    case "text":
      assistant.text += event.data.text;
      appendText(assistant, event.data.text);
      return false;
    case "tool":
      if (assistant.text.trim() && !assistant.text.endsWith("\n\n")) assistant.text += "\n\n";
      assistant.tools.push({
        id: event.data.id,
        name: event.data.name,
        status: "running",
        input: summarize(event.data.input),
        detail: summarize(event.data.input),
      });
      (assistant.parts ??= legacyParts(assistant)).push({ type: "tool", id: event.data.id });
      return false;
    case "tool-result": {
      const chip = assistant.tools.find((item) => item.id === event.data.id);
      if (chip) {
        chip.status = event.data.error ? "error" : "done";
        chip.detail = event.data.error || summarize(event.data.output);
      }
      return false;
    }
    case "project":
      ingest(event.data);
      return false;
    case "error":
      state.error = event.data.error;
      assistant.run = undefined;
      return false;
    case "done":
      assistant.run = undefined;
      return false;
    default:
      return false;
  }
}
