import type { AntigravityUsage } from "@ai-projector/core/modules/agents-integration/antigravity/index.ts";

async function call(url: string, init?: RequestInit): Promise<AntigravityUsage> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Лимиты Antigravity недоступны");
  return (await response.json()) as AntigravityUsage;
}

/** Reads only the server's cached snapshot without spawning `agy`. */
export const readCachedAntigravityUsage = () => call("/api/antigravity/usage");

/** Explicit manual refresh via official `agy -p "/usage"`. */
export const refreshAntigravityUsageApi = () =>
  call("/api/antigravity/usage/refresh", { method: "POST" });
