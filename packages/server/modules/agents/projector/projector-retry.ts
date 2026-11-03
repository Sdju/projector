import { APICallError } from "ai";

/** Repeats of a request that failed before the model said anything. */
export const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_500;
const MAX_DELAY_MS = 20_000;

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"]);

/** Rate limits, provider-side failures and dropped connections are worth another try; bad requests and keys are not. */
export function isRetryable(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    return error.isRetryable || status === 429 || (status !== undefined && status >= 500);
  }
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  const code = (error.cause as { code?: string } | undefined)?.code;
  return error.message === "fetch failed" || (code !== undefined && TRANSIENT_CODES.has(code));
}

/** Exponential backoff, or the provider's own `Retry-After` when it asks for a pause. */
export function retryDelay(attempt: number, error?: unknown): number {
  if (APICallError.isInstance(error)) {
    const header = error.responseHeaders?.["retry-after"];
    const seconds = Number(header);
    if (header && Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_DELAY_MS);
  }
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

/** Waits `ms` and gives up at once when the turn is stopped. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
