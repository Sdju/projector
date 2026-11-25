export type JsonObject = Record<string, unknown>;

export const objectOf = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
export const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
export const string = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function preview(value: unknown, limit = 140): string {
  const text = typeof value === "string" ? value : "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function usageOf(tokens: unknown, cost: unknown): Record<string, number> | undefined {
  const raw = objectOf(tokens);
  const cache = objectOf(raw?.cache);
  const usage = {
    ...(number(raw?.input) === undefined ? {} : { input: number(raw?.input)! }),
    ...(number(raw?.output) === undefined ? {} : { output: number(raw?.output)! }),
    ...(number(cache?.read) === undefined ? {} : { cacheRead: number(cache?.read)! }),
    ...(number(cache?.write) === undefined ? {} : { cacheWrite: number(cache?.write)! }),
    ...(number(cost) === undefined ? {} : { cost: number(cost)! }),
  };
  return Object.keys(usage).length ? usage : undefined;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .flatMap((item) => {
        const raw = objectOf(item);
        return typeof raw?.text === "string" ? [raw.text] : [];
      })
      .join("\n");
  const raw = objectOf(value);
  if (typeof raw?.text === "string") return raw.text;
  if (typeof raw?.output === "string") return raw.output;
  return "";
}

interface ToolState {
  status?: string;
  input?: unknown;
  metadata?: unknown;
  content?: unknown;
  error?: unknown;
}

interface AssistantBlock {
  type?: string;
  text?: string;
  time?: { created?: number; ran?: number; completed?: number };
  id?: string;
  name?: string;
  state?: ToolState;
  executed?: boolean;
}

export interface AssistantData {
  time?: { created?: number; streamed?: number; completed?: number };
  model?: { providerID?: string; id?: string; variant?: string };
  agent?: string;
  content?: AssistantBlock[];
  tokens?: unknown;
  cost?: number;
  finish?: string;
  error?: unknown;
  retry?: unknown;
}

type RecordStatus = "running" | "done" | "error" | "stopped";
type RecordKind =
  | "user"
  | "assistant"
  | "thought"
  | "tool"
  | "context"
  | "system"
  | "compaction"
  | "note";

export interface RecordOut {
  id: string;
  kind: RecordKind;
  turn: number;
  title: string;
  text?: string;
  detail?: string;
  input?: string;
  output?: string;
  status?: RecordStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  callId?: string;
  usage?: Record<string, number>;
  timing?: { ttftMs?: number; decodingMs?: number };
  tool?: {
    id: string;
    name: string;
    status: RecordStatus;
    input?: string;
    detail: string;
    output?: string;
    startedAt?: number;
    endedAt?: number;
  };
  meta?: Record<string, string | number | boolean | null>;
}

export interface TurnOut {
  number: number;
  id: string;
  title: string;
  startedAt?: number;
  endedAt?: number;
  status: RecordStatus;
  records: RecordOut[];
}

export interface MessageRow {
  seq: number;
  type: string;
  time_created: number;
  data: string;
}

function toolStatus(state: ToolState | undefined): RecordStatus {
  if (state?.status === "completed" || state?.status === "done") return "done";
  if (state?.status === "failed" || state?.status === "error") return "error";
  return "running";
}

function toolDetail(state: ToolState | undefined): string {
  const error = objectOf(state?.error);
  if (typeof error?.message === "string") return error.message;
  const content = textOf(state?.content).trim();
  if (content) return content;
  const metadata = objectOf(state?.metadata);
  if (typeof metadata?.output === "string") return metadata.output;
  if (metadata) return JSON.stringify(metadata, null, 2);
  return "";
}

function toolInput(state: ToolState | undefined): string | undefined {
  if (state?.input === undefined) return undefined;
  if (typeof state.input === "string") return state.input;
  try {
    return JSON.stringify(state.input);
  } catch {
    return "[unserializable input]";
  }
}

export function stepRecords(
  row: MessageRow,
  data: AssistantData,
  turn: TurnOut,
  step: number,
  sessionId: string,
): void {
  const started = number(data.time?.created);
  const streamed = number(data.time?.streamed);
  const completed = number(data.time?.completed);
  const error = data.finish === "error" || data.error != null;
  const status: RecordStatus = error ? "error" : completed === undefined ? "running" : "done";
  const usage = usageOf(data.tokens, data.cost);
  const model = objectOf(data.model);
  const stepId = `step:${sessionId}:${row.seq}`;
  const ttft = streamed !== undefined && started !== undefined ? streamed - started : undefined;
  const decoding =
    completed !== undefined && streamed !== undefined ? completed - streamed : undefined;
  const duration =
    completed !== undefined && started !== undefined ? completed - started : undefined;
  turn.records.push({
    id: stepId,
    kind: "assistant",
    turn: turn.number,
    title: `Шаг ${step}`,
    status,
    ...(started === undefined ? {} : { startedAt: started }),
    ...(completed === undefined ? {} : { endedAt: completed }),
    ...(duration === undefined ? {} : { durationMs: Math.max(0, duration) }),
    ...(ttft === undefined && decoding === undefined
      ? {}
      : {
          timing: {
            ...(ttft === undefined ? {} : { ttftMs: ttft }),
            ...(decoding === undefined ? {} : { decodingMs: decoding }),
          },
        }),
    ...(usage === undefined ? {} : { usage }),
    meta: {
      ...(string(model?.id) === undefined ? {} : { model: string(model?.id)! }),
      ...(string(model?.providerID) === undefined ? {} : { provider: string(model?.providerID)! }),
      ...(data.finish === undefined ? {} : { finish: data.finish }),
      ...(data.agent === undefined ? {} : { agent: data.agent }),
    },
  });
  if (completed !== undefined) turn.endedAt = Math.max(turn.endedAt ?? 0, completed);
  if (status === "running") {
    turn.status = "running";
    delete turn.endedAt;
  }
  if (status === "error") turn.status = "error";

  const content = array(data.content);
  for (const [index, item] of content.entries()) {
    const block = objectOf(item) as AssistantBlock | undefined;
    if (!block) continue;
    if (block.type === "text") {
      const text = block.text?.trim() ?? "";
      if (!text) continue;
      turn.records.push({
        id: `text:${sessionId}:${row.seq}:${index}`,
        kind: "assistant",
        turn: turn.number,
        title: "Ответ",
        text: preview(text),
        detail: text,
        status,
        ...(started === undefined ? {} : { startedAt: started }),
      });
      continue;
    }
    if (block.type === "reasoning") {
      const text = block.text?.trim() ?? "";
      if (!text) continue;
      const from = number(block.time?.created) ?? started;
      const to = number(block.time?.completed) ?? completed;
      turn.records.push({
        id: `thought:${sessionId}:${row.seq}:${index}`,
        kind: "thought",
        turn: turn.number,
        title: "Размышление",
        text: preview(text),
        detail: text,
        status,
        ...(from === undefined ? {} : { startedAt: from }),
        ...(to === undefined ? {} : { endedAt: to }),
        ...(from === undefined || to === undefined ? {} : { durationMs: Math.max(0, to - from) }),
      });
      continue;
    }
    if (block.type === "tool") {
      const state = block.state;
      const name = block.name || "tool";
      const toolId = block.id || `tool:${row.seq}:${index}`;
      const from = number(block.time?.ran) ?? number(block.time?.created) ?? started;
      const to = number(block.time?.completed) ?? completed;
      const detail = toolDetail(state);
      const input = toolInput(state);
      const toolStatusValue = toolStatus(state);
      turn.records.push({
        id: `tool:${sessionId}:${toolId}`,
        kind: "tool",
        turn: turn.number,
        title: name,
        ...(preview(detail) ? { text: preview(detail) } : {}),
        status: toolStatusValue,
        ...(from === undefined ? {} : { startedAt: from }),
        ...(to === undefined ? {} : { endedAt: to }),
        ...(from === undefined || to === undefined ? {} : { durationMs: Math.max(0, to - from) }),
        callId: toolId,
        tool: {
          id: toolId,
          name,
          status: toolStatusValue,
          detail,
          ...(input === undefined ? {} : { input }),
          ...(from === undefined ? {} : { startedAt: from }),
          ...(to === undefined ? {} : { endedAt: to }),
        },
        meta: {
          tool: name,
          ...(number(objectOf(state?.metadata)?.exit) === undefined
            ? {}
            : { exit: number(objectOf(state?.metadata)?.exit)! }),
          ...(objectOf(state?.metadata)?.truncated === true ? { truncated: true } : {}),
        },
      });
    }
  }
  if (error) {
    const message =
      textOf((data.error as JsonObject | undefined)?.message) || "Шаг завершился ошибкой";
    turn.records.push({
      id: `error:${sessionId}:${row.seq}`,
      kind: "note",
      turn: turn.number,
      title: "Ошибка шага",
      text: preview(message),
      detail: message,
      status: "error",
      ...(started === undefined ? {} : { startedAt: started }),
    });
  }
}
