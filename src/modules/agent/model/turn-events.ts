import type { Project } from "../../project/index.ts";
import { toolLabel } from "../lib/tool-labels.ts";
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

type ToolTimes = { startedAt?: number; endedAt?: number };
/**
 * Times of the calls of each answer. A rejoin replays the answer into a cleared turn, and the
 * replay must not restart the clock of a call that was already timed before it.
 */
const toolTimes = new WeakMap<AgentTurn, Map<string, ToolTimes>>();

function timesOf(assistant: AgentTurn): Map<string, ToolTimes> {
  const known = toolTimes.get(assistant);
  if (known) return known;
  const times = new Map<string, ToolTimes>();
  toolTimes.set(assistant, times);
  return times;
}

/** Keeps the times of the calls already seen, then empties the answer for its replay. */
export function resetAnswer(assistant: AgentTurn) {
  const times = timesOf(assistant);
  for (const tool of assistant.tools)
    if (tool.startedAt !== undefined || tool.endedAt !== undefined)
      times.set(tool.id, { startedAt: tool.startedAt, endedAt: tool.endedAt });
  assistant.text = "";
  assistant.tools.splice(0);
  assistant.parts = [];
}

export function appendText(turn: AgentTurn, text: string) {
  const parts = (turn.parts ??= legacyParts({ ...turn, text: turn.text.slice(0, -text.length) }));
  const last = parts.at(-1);
  if (last?.type === "text") last.text += text;
  else parts.push({ type: "text", text });
}

export function appendThought(turn: AgentTurn, text: string) {
  const parts = (turn.parts ??= legacyParts(turn));
  const last = parts.at(-1);
  if (last?.type === "thought") last.text += text;
  else parts.push({ type: "thought", text });
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
  at = Date.now(),
): boolean {
  switch (event.event) {
    case "input":
      if (event.data.inputId)
        state.queue = state.queue.filter((item) => item.id !== event.data.inputId);
      (assistant.parts ??= legacyParts(assistant)).push({ type: "note", text: event.data.text });
      return true;
    case "status":
      state.phase =
        event.data.phase === "fallback"
          ? `запасная модель · ${event.data.model}`
          : event.data.model
            ? `${event.data.provider ?? "qwen"} · ${event.data.model}`
            : event.data.phase === "compacting"
              ? "сжимаю историю"
              : event.data.phase === "retrying"
                ? `провайдер не ответил, повтор ${event.data.attempt}`
                : event.data.phase === "background"
                  ? "ждёт фоновых агентов"
                  : "думает";
      return false;
    case "run":
      assistant.run = event.data.id;
      return true;
    case "session":
      assistant.session = event.data;
      return true;
    case "worktree":
      assistant.worktree = event.data;
      return true;
    case "checkpoint":
      assistant.tail = event.data.tail;
      return true;
    case "commands":
      // An agent that lists its commands while answering knows more than the list asked for.
      state.commands = event.data.commands;
      return false;
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
    case "usage":
      assistant.usage = event.data;
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
    case "question-request":
      state.questions.push(event.data);
      return false;
    case "secret-request":
      state.secrets.push(event.data);
      return false;
    case "text":
      assistant.text += event.data.text;
      appendText(assistant, event.data.text);
      return false;
    case "thought":
      appendThought(assistant, event.data.text);
      return false;
    case "tool":
      // A repeated call carries the input that completed later: update it, do not add a second one.
      const again = assistant.tools.find((item) => item.id === event.data.id);
      if (again) {
        if (again.status === "running") again.detail = summarize(event.data.input);
        again.input = summarize(event.data.input);
        return false;
      }
      if (assistant.text.trim() && !assistant.text.endsWith("\n\n")) assistant.text += "\n\n";
      // Taken before the call is added: a turn without parts yet derives them from its tools.
      const parts = (assistant.parts ??= legacyParts(assistant));
      const timed = timesOf(assistant);
      const known = timed.get(event.data.id);
      const chip = {
        id: event.data.id,
        name: event.data.name,
        status: "running" as const,
        input: summarize(event.data.input),
        detail: summarize(event.data.input),
        startedAt: known?.startedAt ?? at,
        ...(known?.endedAt !== undefined ? { endedAt: known.endedAt } : {}),
        ...(event.data.parent ? { parent: event.data.parent } : {}),
      };
      assistant.tools.push(chip);
      timed.set(chip.id, { startedAt: chip.startedAt, endedAt: chip.endedAt });
      parts.push({ type: "tool", id: event.data.id });
      return false;
    case "tool-result": {
      const chip = assistant.tools.find((item) => item.id === event.data.id);
      if (chip) {
        const timed = timesOf(assistant);
        const known = timed.get(chip.id);
        chip.status = event.data.error ? "error" : "done";
        chip.detail = event.data.error || summarize(event.data.output);
        chip.endedAt = known?.endedAt ?? at;
        timed.set(chip.id, { startedAt: chip.startedAt, endedAt: chip.endedAt });
      }
      return false;
    }
    case "task": {
      const tasks = (assistant.tasks ??= []);
      const known = tasks.find((item) => item.id === event.data.id);
      // A background task reports in a later answer: carry over what the earlier one knew.
      const earlier = known
        ? undefined
        : (state.turns ?? [])
            .flatMap((turn) => turn.tasks ?? [])
            .findLast((item) => item.id === event.data.id);
      const task =
        known ??
        tasks[
          tasks.push({
            kind: "other",
            title: "",
            status: "running",
            background: false,
            ...earlier,
            ...event.data,
          }) - 1
        ]!;
      if (known) Object.assign(known, event.data);
      // What the task reports along the way becomes its progress log (no repeats, bounded).
      const line = event.data.summary || (event.data.lastTool && toolLabel(event.data.lastTool));
      if (line && task.log?.at(-1) !== line) task.log = [...(task.log ?? []), line].slice(-100);
      // The chat times the task itself: an adapter may report a duration, but not for every task.
      if (task.status === "running") {
        task.startedAt ??= at;
        task.endedAt = undefined;
      } else if (task.startedAt !== undefined && task.endedAt === undefined) task.endedAt = at;
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
      assistant.stopped = event.data.stopped;
      // A foreground task cannot outlive the answer; a background one may and reports later,
      // unless the agent never reports (then its state is unknown once the answer is over).
      for (const task of assistant.tasks ?? [])
        if (task.status === "running" && (!task.background || task.untracked)) {
          task.status = "stopped";
          task.endedAt = at;
          if (task.untracked) task.summary ??= "Состояние после ответа неизвестно";
        }
      return false;
    default:
      return false;
  }
}
