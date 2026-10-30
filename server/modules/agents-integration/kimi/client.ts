import { readKimiAccessToken } from "./credentials.ts";

const USAGE_URL = "https://api.kimi.com/coding/v1/usages";

/** Fixed official destination, bounded request, no upstream body in errors. */
export async function readKimiUsage(timeoutMs = 10000): Promise<unknown> {
  const token = await readKimiAccessToken();
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "KimiCLI/1.6",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось получить лимиты Kimi Code");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401)
      throw new Error("Авторизация Kimi Code истекла; выполните kimi login");
    if (response.status === 403) throw new Error("Подписка Kimi Code недоступна");
    throw new Error(`Kimi Code: ошибка HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Некорректный ответ Kimi Code");
  }
}
