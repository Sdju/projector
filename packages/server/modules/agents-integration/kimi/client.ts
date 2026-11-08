import { readKimiAccessToken } from "./credentials.ts";

const USAGE_URL = "https://api.kimi.com/coding/v1/usages";

/** Production keeps ten seconds; a test can shorten the bound through the environment. */
function usageTimeoutMs(): number {
  const configured = Number(process.env.PROJECTOR_KIMI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

/** Fixed official destination, bounded request, no upstream body in errors. */
function requestUsage(token: string, timeoutMs: number): Promise<Response> {
  return fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "KimiCLI/1.6",
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  }).catch(() => {
    throw new Error("Не удалось получить лимиты Kimi Code");
  });
}

function errorForResponse(response: Response): Error {
  if (response.status === 401)
    return new Error("Авторизация Kimi Code истекла; выполните kimi login");
  if (response.status === 403) return new Error("Подписка Kimi Code недоступна");
  return new Error(`Kimi Code: ошибка HTTP ${response.status}`);
}

export async function readKimiUsage(timeoutMs = usageTimeoutMs()): Promise<unknown> {
  let token = await readKimiAccessToken();
  let response = await requestUsage(token, timeoutMs);
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    /* The token may have been rejected between reads; force one refresh and retry. */
    token = await readKimiAccessToken(true);
    response = await requestUsage(token, timeoutMs);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw errorForResponse(response);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Некорректный ответ Kimi Code");
  }
}
