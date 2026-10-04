import { os } from "../../../core/modules/os/index.ts";

/** Fixed official destination, bounded request, no upstream body in errors. */
export async function readGoUsage(timeoutMs = 10000): Promise<unknown> {
  const key = await os.tools.readOpenCodeGoKey();
  let response: Response;
  try {
    response = await fetch("https://opencode.ai/zen/go/v1/usage", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось получить лимиты OpenCode Go");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401)
      throw new Error("Авторизация OpenCode Go истекла; выполните opencode auth login");
    if (response.status === 403) throw new Error("Подписка OpenCode Go недоступна");
    throw new Error(`OpenCode Go: ошибка HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Некорректный ответ OpenCode Go");
  }
}
