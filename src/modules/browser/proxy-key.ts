let key: Promise<string> | undefined;

/** Ключ origin прокси: сервер выдаёт его только странице Projector. */
export function browserProxyKey(): Promise<string> {
  key ??= fetch("/api/browser/session", { cache: "no-store" })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || typeof data.key !== "string")
        throw new Error(data.error || "Прокси браузера недоступен");
      return data.key as string;
    })
    .catch((error) => {
      key = undefined;
      throw error;
    });
  return key;
}
