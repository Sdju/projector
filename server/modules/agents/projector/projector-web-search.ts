import { fieldText, integrationConfig, updateIntegration } from "../../integration-store/index.ts";

export const WEB_SEARCH_ID = "web-search";
export const SEARCH_PROVIDERS = ["brave", "searxng"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchSettings {
  provider: SearchProvider;
  /** SearXNG instance address. */
  url: string;
  hasKey: boolean;
}

/** What the settings page shows; the key itself never leaves the server. */
export async function webSearchSettings(): Promise<WebSearchSettings> {
  const config = await integrationConfig(WEB_SEARCH_ID);
  const provider = SEARCH_PROVIDERS.find((item) => item === config.settings.provider) ?? "brave";
  return { provider, url: config.settings.url ?? "", hasKey: !!config.credentials.token };
}

/** Chooses the search service; an empty `apiKey` keeps the stored key, `null` removes it. */
export async function configureWebSearch(input: {
  provider?: unknown;
  url?: unknown;
  apiKey?: unknown;
}): Promise<WebSearchSettings> {
  const provider = SEARCH_PROVIDERS.find((item) => item === input.provider);
  if (!provider) throw new Error("Поиск: brave или searxng");
  const url = fieldText(input.url).replace(/\/+$/, "");
  if (provider === "searxng" && !/^https?:\/\/.+/.test(url))
    throw new Error("Для SearXNG укажите адрес сервера: http:// или https://");
  const key = input.apiKey === null ? null : fieldText(input.apiKey);
  await updateIntegration(WEB_SEARCH_ID, (config) => ({
    ...config,
    enabled: true,
    settings: { ...config.settings, provider, url },
    credentials:
      key === null ? {} : key ? { ...config.credentials, token: key } : config.credentials,
  }));
  return webSearchSettings();
}

/** Saves the key the user typed into the agent's secret form; the service is left as it was. */
export async function storeSearchKey(key: string): Promise<void> {
  await updateIntegration(WEB_SEARCH_ID, (config) => ({
    ...config,
    enabled: true,
    credentials: { ...config.credentials, token: key },
  }));
}

async function getJson(url: URL, headers: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`Поиск ответил ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Searches the web with the service chosen in settings; results are data from the outside. */
export async function webSearch(
  query: string,
  count = 8,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const config = await integrationConfig(WEB_SEARCH_ID);
  const settings = await webSearchSettings();
  const limit = Math.min(Math.max(count, 1), 20);
  if (settings.provider === "searxng") {
    if (!settings.url) throw new Error("Веб-поиск не настроен: укажите адрес SearXNG в настройках");
    const url = new URL(`${settings.url}/search`);
    url.search = new URLSearchParams({ q: query, format: "json" }).toString();
    const data = await getJson(url, {}, signal);
    return ((data.results as Record<string, unknown>[] | undefined) ?? [])
      .slice(0, limit)
      .map((item) => ({
        title: text(item.title),
        url: text(item.url),
        snippet: text(item.content),
      }));
  }
  const key = config.credentials.token;
  if (!key)
    throw new Error(
      "Веб-поиск не настроен: нужен ключ Brave Search. Запроси его через request_secret (kind integration, integration web_search) или откажись от поиска",
    );
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.search = new URLSearchParams({ q: query, count: String(limit) }).toString();
  const data = await getJson(url, { "x-subscription-token": key }, signal);
  const results = (data.web as { results?: Record<string, unknown>[] } | undefined)?.results ?? [];
  return results.map((item) => ({
    title: text(item.title),
    url: text(item.url),
    snippet: text(item.description).replace(/<[^>]+>/g, ""),
  }));
}
