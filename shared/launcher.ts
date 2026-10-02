export type InterfaceMode = "native" | "window" | "browser";
export const shortcuts = ["", "Ctrl+Alt+Space", "Super+Space", "Alt+Space"];
export interface LaunchItem {
  id: string;
  name: string;
  description: string;
  keywords: string;
  kind: "application" | "project";
  icon?: string;
}
export interface SearchResult { items: LaunchItem[]; warning?: string }
export interface ShortcutStatus { supported: boolean; active: boolean; shortcut: string }
export type DesktopAction = "show" | "toggle" | "tray" | "quit";

/** Same HTTP contract in the browser and the native Node process. */
export function createLauncherClient(baseUrl = "") {
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(baseUrl + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ошибка запроса (${response.status})`);
    return data as T;
  }
  return {
    search: (query: string, signal?: AbortSignal) => request<SearchResult>(`/api/launcher/search?q=${encodeURIComponent(query)}`, undefined, signal),
    launch: (id: string) => request<{ ok: boolean }>("/api/launcher/launch", { id }),
    hide: () => request<{ ok: boolean }>("/api/app/hide", {}),
    open: (toggle = false) => request<{ ok: boolean }>("/api/app/open", { toggle }),
    quit: () => request<{ ok: boolean }>("/api/app/quit", {}),
  };
}
export type LauncherClient = ReturnType<typeof createLauncherClient>;
