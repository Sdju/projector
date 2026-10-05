import { os } from "../../../core/modules/os/index.ts";

export class ClaudeUsageError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** A zero/malformed Retry-After must never cause an immediate retry loop. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 ? delay : null;
}

export async function readClaudeUsage(timeoutMs = 10000): Promise<unknown> {
  const token = await os.tools.readClaudeAccessToken();
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new ClaudeUsageError("Не удалось получить лимиты Claude Code");
  }
  if (!response.ok) {
    const delay = retryAfterMs(response.headers.get("retry-after"));
    await response.body?.cancel();
    if (response.status === 401)
      throw new ClaudeUsageError("Авторизация Claude Code истекла; откройте Claude Code или выполните claude auth login");
    if (response.status === 403)
      throw new ClaudeUsageError("Лимиты подписки Claude Code недоступны для этой авторизации");
    if (response.status === 429)
      throw new ClaudeUsageError("Claude Code: запросы лимитов временно ограничены; повторим позже", delay ?? 0);
    throw new ClaudeUsageError(`Claude Code: ошибка HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ClaudeUsageError("Некорректный ответ Claude Code");
  }
}
