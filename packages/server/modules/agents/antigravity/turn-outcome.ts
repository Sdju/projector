import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentFailure } from "@ai-projector/core/modules/agent-failure/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { makeFailure } from "../../agent/index.ts";

// CORTEX_STEP_TYPE_ERROR_MESSAGE in the native trajectory.
const ERROR_STEP_TYPE = 17;
const MAX_ERROR_PAYLOAD_BYTES = 16_384;
const NATIVE_SESSION_ID = /^[\w-]+$/;

const API_ERROR = /Error (\d{3}), Message: (.+?), Status: ([A-Z_]+)/s;
const QUOTA_EXHAUSTED = /\breason:QUOTA_EXHAUSTED\b/;
const RESET_TIMESTAMP = /\bquotaResetTimeStamp:([^\s\]]+)/;
const RESET_DELAY = /\bquotaResetDelay:((?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|h|m|s))+)(?=[\s\]])/;
const RETRY_DELAY = /\bretryDelay:((?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|h|m|s))+)(?=[\s\]])/;
const GO_DURATION_PART = /(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|h|m|s)/g;
const GO_DURATION_UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  μs: 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

interface LastStep {
  type: number;
  payload: Uint8Array | null;
}

function resetAtFrom(text: string, nowMs: number): number | undefined {
  const iso = RESET_TIMESTAMP.exec(text)?.[1];
  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const delay = RESET_DELAY.exec(text)?.[1] ?? RETRY_DELAY.exec(text)?.[1];
  if (!delay) return undefined;
  let delayMs = 0;
  for (const [, amount, unit] of delay.matchAll(GO_DURATION_PART)) {
    delayMs += Number(amount) * (GO_DURATION_UNIT_MS[unit!] ?? 0);
  }
  return delayMs > 0 ? Math.round(nowMs + delayMs) : undefined;
}

export function classifyAntigravityTurnFailure(
  stopReason: unknown,
  step: LastStep | undefined,
  nowMs = Date.now(),
): AgentFailure | undefined {
  const errorText =
    step?.type === ERROR_STEP_TYPE
      ? new TextDecoder().decode(step.payload ?? new Uint8Array())
      : undefined;
  // Antigravity maps QUOTA_EXHAUSTED to stopReason `refusal`.
  if (errorText === undefined && stopReason !== "refusal") return undefined;
  const text = errorText ?? "";
  const apiError = API_ERROR.exec(text);
  const resetAt = resetAtFrom(text, nowMs);
  if (stopReason === "refusal" || QUOTA_EXHAUSTED.test(text)) {
    return makeFailure({
      class: "usage_limit",
      message: "Достигнут лимит квоты Antigravity для текущего периода",
      code: apiError?.[3] ?? "QUOTA_EXHAUSTED",
      retryable: true,
      ...(resetAt !== undefined ? { resetAt } : {}),
    });
  }
  if (!apiError) {
    return makeFailure({
      class: "provider_error",
      message: "Antigravity прервал ответ из-за ошибки",
    });
  }
  const httpStatus = Number(apiError[1]);
  const message = apiError[2]!.trim();
  const status = apiError[3] ?? null;
  const rateLimited = httpStatus === 429 || status === "RESOURCE_EXHAUSTED";
  return makeFailure({
    class: rateLimited ? "usage_limit" : "provider_error",
    message,
    code: status,
    retryable: rateLimited || httpStatus >= 500,
    ...(resetAt !== undefined ? { resetAt } : {}),
  });
}

function readDb<T>(file: string, read: (db: DatabaseSync) => T): T | undefined {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: 100 });
    const hasSteps =
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'steps'").get() !==
      undefined;
    return hasSteps ? read(db) : undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

async function regularFileInfo(file: string) {
  try {
    const info = await lstat(file);
    return info.isFile() ? info : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Antigravity reports upstream API failures (429 / QUOTA_EXHAUSTED / 5xx) as a plain chat message
 * followed by `end_turn`, or `refusal` for quota exhaustion. Watching the session's own SQLite
 * database lets Projector surface structured, retryable failures without touching any network API.
 */
export async function watchAntigravityPromptOutcome(
  sessionId: string,
  conversationsDir = join(os.homeDirectory(), ".gemini", "antigravity-cli", "conversations"),
): Promise<(stopReason: unknown) => Promise<AgentFailure | undefined>> {
  const typedOnly = async (stopReason: unknown) =>
    classifyAntigravityTurnFailure(stopReason, undefined);
  if (!NATIVE_SESSION_ID.test(sessionId)) return typedOnly;
  const file = join(conversationsDir, `${sessionId}.db`);
  const before = await regularFileInfo(file);
  const startIndex = before
    ? (readDb(file, (db) => {
        const row = db.prepare("SELECT max(idx) AS idx FROM steps").get() as { idx?: unknown };
        return typeof row?.idx === "number" ? row.idx : -1;
      }) ?? -1)
    : -1;

  return async (stopReason: unknown) => {
    const after = await regularFileInfo(file);
    const sameFile =
      after !== undefined &&
      (before === undefined || (after.dev === before.dev && after.ino === before.ino));
    const step = sameFile
      ? readDb(file, (db): LastStep | undefined => {
          const row = db
            .prepare(
              "SELECT step_type AS type, substr(step_payload, 1, ?) AS payload FROM steps WHERE idx > ? ORDER BY idx DESC LIMIT 1",
            )
            .get(MAX_ERROR_PAYLOAD_BYTES, startIndex) as
            | { type?: unknown; payload?: unknown }
            | undefined;
          if (typeof row?.type !== "number") return undefined;
          return {
            type: row.type,
            payload: row.payload instanceof Uint8Array ? row.payload : null,
          };
        })
      : undefined;
    return classifyAntigravityTurnFailure(stopReason, step);
  };
}
