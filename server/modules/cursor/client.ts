import { os } from "../../../core/modules/os/index.ts";

const USAGE_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

/** Fixed official destination, bounded request, no upstream body in errors. */
export async function readCursorUsage(timeoutMs = 10000): Promise<unknown> {
  const token = await os.tools.readCursorAccessToken();
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось получить лимиты Cursor");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401)
      throw new Error("Авторизация Cursor истекла; выполните agent login");
    if (response.status === 403) throw new Error("Подписка Cursor недоступна");
    throw new Error(`Cursor: ошибка HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Некорректный ответ Cursor");
  }
}
