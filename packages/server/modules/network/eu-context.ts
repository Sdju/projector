export const NETWORK_CONTEXT_URL = "https://ipwho.is/";

/** Fixed public probe; usage requests must not run until EU network context is confirmed. */
export async function assertEuNetworkContext(timeoutMs: number) {
  let response: Response;
  try {
    response = await fetch(NETWORK_CONTEXT_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось проверить сетевой контекст");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Не удалось проверить сетевой контекст");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Не удалось проверить сетевой контекст");
  }
  const probe =
    body && typeof body === "object" ? (body as { success?: unknown; is_eu?: unknown }) : null;
  if (probe?.success !== true || probe.is_eu !== true)
    throw new Error("Не удалось проверить сетевой контекст");
}
