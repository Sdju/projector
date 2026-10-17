import { randomUUID } from "node:crypto";

export interface CommandRequest {
  operation: "list" | "describe" | "execute";
  query?: string;
  command?: string;
  scope?: string;
  args?: unknown;
}

/** A backend asks the user before running a tool it considers sensitive. */
export interface ApprovalRequest {
  tool: string;
  input: unknown;
  /** Backend-provided one-line label, e.g. "Edit src/main.ts". */
  title?: string;
  /** What exactly will happen (diff, command, arguments), shown under the title. */
  detail?: string;
  /** The backend can remember the decision, so the prompt offers a separate "always" choice. */
  persistent?: boolean;
}

/** `true` allows this call once, `"always"` also remembers it; `false` denies. */
export type ApprovalAnswer = boolean | "always";

/** One question an agent puts to the user, with the answers it suggests. */
export interface AgentQuestion {
  /** Stable within the request; answers are keyed by it. */
  id: string;
  question: string;
  header?: string;
  options: { id: string; label: string; description?: string }[];
  /** More than one option can be chosen. */
  multiple: boolean;
  /** The user may write an answer of their own to this question. */
  custom?: boolean;
  /** The agent accepts the form without an answer to this one. */
  optional?: boolean;
}

export interface QuestionRequest {
  title?: string;
  questions: AgentQuestion[];
  /** The user may write an answer of their own instead of choosing an option. */
  custom: boolean;
}

/** Answers by question ID: option IDs, or the user's own words; `null` when the user skipped. */
export type QuestionAnswer = Record<string, string[]> | null;

/**
 * Where a secret goes, as the user sees it. Paths and internal IDs stay on the server; the form
 * shows the destination before the user types anything.
 */
export type SecretDestination =
  | { kind: "env_file"; file: string; key: string; replaces: boolean }
  | {
      kind: "ai_provider";
      id: string;
      name: string;
      url: string;
      model: string;
      replaces: boolean;
    }
  | { kind: "integration"; integration: "github" | "gitlab"; label: string; replaces: boolean };

/** Asks the user for a secret; the value goes to the server code that stores it, not to the model. */
export interface SecretRequest {
  /** What the secret is, in the user's words. */
  label: string;
  destination: SecretDestination;
  /** Why the agent needs it. */
  reason?: string;
}

type BridgeResult = { output?: unknown; error?: string };
const pending = new Map<string, (result: BridgeResult) => void>();

/** Each request has a single-use capability, delivered only to its originating SSE client. */
function bridgeRequest(
  send: (data: unknown) => void,
  payload: object,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Запрос остановлен"));
    const id = randomUUID();
    const finish = (result: BridgeResult) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      pending.delete(id);
      if (result.error) reject(new Error(result.error));
      else resolve(result.output);
    };
    const cancel = () => finish({ error: "Запрос остановлен" });
    const timer = setTimeout(() => finish({ error: timeoutMessage }), timeoutMs);
    pending.set(id, finish);
    signal.addEventListener("abort", cancel, { once: true });
    send({ id, ...payload });
  });
}

export function createCommandBridge(
  emit: (event: "command-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 60000,
) {
  return (request: CommandRequest): Promise<unknown> =>
    bridgeRequest(
      (data) => emit("command-request", data),
      request,
      signal,
      timeoutMs,
      "Projector не ответил на вызов команды",
    );
}

/** Resolves `true` only when the user explicitly allows; a denial, timeout or abort rejects or yields `false`. */
export function createApprovalBridge(
  emit: (event: "permission-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 10 * 60_000,
) {
  return async (request: ApprovalRequest): Promise<ApprovalAnswer> => {
    const output = await bridgeRequest(
      (data) => emit("permission-request", data),
      request,
      signal,
      timeoutMs,
      "Разрешение не получено вовремя",
    );
    const answer = output as { allow?: unknown; always?: unknown } | undefined;
    if (answer?.allow !== true) return false;
    return answer.always === true ? "always" : true;
  };
}

/** Resolves the user's answers, `null` when they skip; abort and timeout reject. */
export function createQuestionBridge(
  emit: (event: "question-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 60 * 60_000,
) {
  return async (request: QuestionRequest): Promise<QuestionAnswer> => {
    const output = await bridgeRequest(
      (data) => emit("question-request", data),
      request,
      signal,
      timeoutMs,
      "Ответ на вопрос не получен вовремя",
    );
    const answers = (output as { answers?: unknown } | undefined)?.answers;
    if (!answers || typeof answers !== "object") return null;
    const result: Record<string, string[]> = {};
    for (const [id, value] of Object.entries(answers)) {
      if (!Array.isArray(value)) continue;
      result[id] = value.filter((item): item is string => typeof item === "string").slice(0, 50);
    }
    return result;
  };
}

/**
 * Resolves the typed secret, `null` when the user declines. The value reaches only the caller
 * that stores it; no event, error text or log of the bridge carries it.
 */
export function createSecretBridge(
  emit: (event: "secret-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 10 * 60_000,
) {
  return async (request: SecretRequest): Promise<string | null> => {
    const output = await bridgeRequest(
      (data) => emit("secret-request", data),
      request,
      signal,
      timeoutMs,
      "Секрет не получен вовремя",
    );
    const value = (output as { value?: unknown } | undefined)?.value;
    return typeof value === "string" && value ? value : null;
  };
}

/**
 * Requests asked by a run held outside this server (its own process): the answer goes back to that
 * process, which keeps the request open. Registered by whichever server is attached to the run.
 */
const relayed = new Map<string, (result: BridgeResult) => void>();

export function relayRequest(id: string, deliver: (result: BridgeResult) => void): void {
  relayed.set(id, deliver);
}

export function unrelayRequests(ids: Iterable<string>): void {
  for (const id of ids) relayed.delete(id);
}

export function completeCommandRequest(id: string, result: BridgeResult): boolean {
  const finish = pending.get(id);
  if (!finish) {
    const deliver = relayed.get(id);
    if (!deliver) return false;
    relayed.delete(id);
    deliver(result);
    return true;
  }
  finish(result);
  return true;
}
