/** How a provider failure is treated by the chat: label, retry policy and quota timing. */
export type AgentFailureClass =
  | "usage_limit"
  | "provider_error"
  | "transport_error"
  | "permission_error"
  | "validation_error"
  | "unknown";

/**
 * A failure of one agent turn, safe to store and to show. `message` is already redacted and
 * bounded; `resetAt` is present only when the provider told us when the quota comes back.
 */
export interface AgentFailure {
  class: AgentFailureClass;
  message: string;
  code: string | null;
  /** `null` means the provider gave no advice: the chat decides by class. */
  retryable: boolean | null;
  /** When the quota resets (ms since the epoch); only for `usage_limit`. */
  resetAt?: number;
}

/** The longest failure text kept in history or sent to a page. */
export const FAILURE_MESSAGE_LIMIT = 4096;

const TITLES: Record<AgentFailureClass, string> = {
  usage_limit: "Достигнут лимит",
  provider_error: "Ошибка агента",
  transport_error: "Обрыв связи с агентом",
  permission_error: "Нужен доступ",
  validation_error: "Запрос отклонён",
  unknown: "Ошибка агента",
};

/** Whether a stored value is a complete failure; a broken one is replaced by a plain error. */
export function isAgentFailure(value: unknown): value is AgentFailure {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!CLASSES.has(row.class as AgentFailureClass)) return false;
  if (typeof row.message !== "string" || !row.message) return false;
  if (row.code !== null && typeof row.code !== "string") return false;
  if (row.retryable !== null && typeof row.retryable !== "boolean") return false;
  return row.resetAt === undefined || typeof row.resetAt === "number";
}

const CLASSES = new Set<AgentFailureClass>([
  "usage_limit",
  "provider_error",
  "transport_error",
  "permission_error",
  "validation_error",
  "unknown",
]);

/** The short label above the provider's own explanation. */
export function failureTitle(failure: AgentFailure): string {
  return TITLES[failure.class];
}

/** Whether the chat may offer an automatic repeat for this failure. */
export function failureRetryable(failure: AgentFailure): boolean {
  if (failure.retryable !== null) return failure.retryable;
  return failure.class === "transport_error" || failure.class === "provider_error";
}

/** A class guessed from the provider's HTTP status; `undefined` when the status says nothing. */
export function failureFromStatus(
  status: number | null | undefined,
): AgentFailureClass | undefined {
  if (status === undefined || status === null || !Number.isFinite(status)) return undefined;
  if (status === 429) return "usage_limit";
  if (status === 401 || status === 403) return "permission_error";
  if (status === 400 || status === 413 || status === 422) return "validation_error";
  if (status >= 500) return "provider_error";
  return undefined;
}

const USAGE_LIMIT =
  /usage.?limit|rate.?limit|quota|insufficient.?quota|too many requests|exceeded.*(?:limit|budget)|credits? (?:are )?(?:exhausted|exceeded)|лимит|квот/i;
const PERMISSION =
  /unauthorized|forbidden|invalid api key|incorrect api key|not logged in|sign in|authenticat|permission denied|access denied|401|403|авториз|доступ/i;
const VALIDATION =
  /context length|context window|too (?:long|large)|request entity too large|payload too large|invalid request|bad request|413|unprocessable|validation|некорректн/i;
const TRANSPORT =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|fetch failed|socket hang up|connection (?:reset|closed|lost)|stream (?:closed|ended)|terminated|обрыв|соединен/i;

/**
 * A class guessed from the provider's own words. Used only when there is no status or typed error:
 * the words of a provider are a hint, not a contract.
 */
export function failureFromText(text: string): AgentFailureClass {
  if (USAGE_LIMIT.test(text)) return "usage_limit";
  if (TRANSPORT.test(text)) return "transport_error";
  if (PERMISSION.test(text)) return "permission_error";
  if (VALIDATION.test(text)) return "validation_error";
  return "unknown";
}

/** The reset the provider wrote in its message, if it wrote one. */
export function failureResetFromText(text: string, now = Date.now()): number | undefined {
  const after = /reset(?:s)? (?:after|in) ((?:\d+\s*[hmsдчм]\s*)+)/i.exec(text);
  if (after) {
    const ms = durationMs(after[1]!);
    if (ms !== undefined) return now + ms;
  }
  const at = /resets?(?: at| on)? (\d{4}-\d{2}-\d{2}[T ][0-9:.]+Z?)/i.exec(text);
  if (at) {
    const value = Date.parse(at[1]!);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

const UNITS: Record<string, number> = {
  h: 3_600_000,
  ч: 3_600_000,
  m: 60_000,
  м: 60_000,
  s: 1_000,
  с: 1_000,
};

function durationMs(value: string): number | undefined {
  let total = 0;
  let found = false;
  for (const match of value.matchAll(/(\d+)\s*([hmsдчм])/gi)) {
    const amount = Number(match[1]);
    const unit = UNITS[match[2]!.toLowerCase()];
    if (!Number.isFinite(amount) || unit === undefined) continue;
    total += amount * unit;
    found = true;
  }
  return found ? total : undefined;
}

/**
 * Text that is safe to keep and to show: credentials, query strings and control characters are
 * removed, the rest is bounded without splitting a surrogate pair.
 */
export function sanitizeFailureText(value: string, maxLength = FAILURE_MESSAGE_LIMIT): string {
  let text = value.replaceAll(/\r\n?/g, "\n");
  text = text.replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  text = text.replaceAll(/\bhttps?:\/\/[^\s<>"']+/gi, redactUrl);
  text = text.replaceAll(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED]");
  text = text.replaceAll(
    /(["'][\w-]*(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)["']\s*:\s*["'])[^"']*(["'])/gi,
    "$1[REDACTED]$2",
  );
  text = text.replaceAll(
    /((?<![\w-])[\w-]*(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1[REDACTED]",
  );
  text = text.replaceAll(
    /\b(?:sk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/gi,
    "[REDACTED]",
  );
  text = text.trim();
  if (text.length <= maxLength) return text;
  let end = Math.max(0, maxLength - 1);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

function redactUrl(match: string): string {
  const trailing = /[),.;!?]+$/.exec(match)?.[0] ?? "";
  const candidate = trailing ? match.slice(0, -trailing.length) : match;
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.toString()}${trailing}`;
  } catch {
    return "[REDACTED_URL]";
  }
}
