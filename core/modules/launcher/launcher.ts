export type InterfaceMode = "native" | "window" | "browser";
export const shortcuts = ["", "Ctrl+Alt+Space", "Super+Space", "Alt+Space"];
/** `launch` — запуск приложения; `open` — воркспейс проекта; `run` — основная команда проекта; `stop` — остановка запущенного. */
export type LaunchActionId = "launch" | "open" | "run" | "stop";
export interface LaunchAction {
  id: LaunchActionId;
  title: string;
}
/** Секции пустого запроса; при поиске по тексту список плоский. */
export type LaunchSection = "running" | "recent" | "projects" | "apps";
export const launchSectionTitles: Record<LaunchSection, string> = {
  running: "Работает",
  recent: "Недавние",
  projects: "Проекты",
  apps: "Приложения",
};
export interface LaunchItem {
  id: string;
  name: string;
  description: string;
  keywords: string;
  kind: "application" | "project";
  icon?: string;
  section?: LaunchSection;
  /** Живое состояние проекта; у приложений нет. */
  status?: { state: "running" | "starting"; label: string };
  /** Первое действие выполняется по Enter, второе — по Ctrl+Enter. */
  actions?: LaunchAction[];
}
export interface LaunchResult {
  ok: boolean;
  /** Маршрут воркспейса для действия `open`. */
  route?: string;
}
export interface SearchResult {
  items: LaunchItem[];
  warning?: string;
}
export interface ShortcutStatus {
  supported: boolean;
  active: boolean;
  shortcut: string;
}

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
    search: (query: string, signal?: AbortSignal) =>
      request<SearchResult>(
        `/api/launcher/search?q=${encodeURIComponent(query)}`,
        undefined,
        signal,
      ),
    /** `inline` — клиент сам перейдёт по `route`, сервер не открывает окно. */
    launch: (id: string, action?: LaunchActionId, inline = false) =>
      request<LaunchResult>("/api/launcher/launch", { id, action, inline }),
    hide: () => request<{ ok: boolean }>("/api/app/hide", {}),
    open: (toggle = false) => request<{ ok: boolean }>("/api/app/open", { toggle }),
    quit: () => request<{ ok: boolean }>("/api/app/quit", {}),
    restart: () => request<{ ok: boolean }>("/api/app/restart", {}),
  };
}
export type LauncherClient = ReturnType<typeof createLauncherClient>;
