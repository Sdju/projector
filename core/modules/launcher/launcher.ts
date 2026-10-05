export type InterfaceMode = "native" | "window" | "browser";
export const shortcuts = ["", "Ctrl+Alt+Space", "Super+Space", "Alt+Space"];
/** `launch` — запуск приложения; `open` — воркспейс проекта; `run` — основная команда проекта; `stop` — остановка запущенного; `browser`/`window` — открыть запущенный проект
 * в браузере или окне (для остановленного `window` запускает команду в окне);
 * `favorite` — добавить в избранное или убрать из него. */
export type LaunchActionId = "launch" | "open" | "run" | "stop" | "browser" | "window" | "favorite";
export interface LaunchAction {
  id: LaunchActionId;
  title: string;
  /** Параметр действия: для `run` — id команды проекта. */
  arg?: string;
}
/** Секции пустого запроса; при поиске по тексту список плоский. */
export type LaunchSection = "favorites" | "running" | "recent" | "projects" | "apps";
export const launchSectionTitles: Record<LaunchSection, string> = {
  favorites: "Избранное",
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
  kind: "application" | "project" | "github";
  icon?: string;
  section?: LaunchSection;
  /** В избранном: такие результаты идут первыми и в поиске, и в обзоре. */
  favorite?: boolean;
  /** Живое состояние проекта; у приложений нет. */
  status?: { state: "running" | "starting" | "stopping" | "error"; label: string };
  /** Первое действие выполняется по Enter, второе — по Ctrl+Enter. */
  actions?: LaunchAction[];
}
/** Данные широкой карточки проекта: путь, состояние запуска и окружение. */
export interface LaunchInfo {
  path: string;
  state: "idle" | "starting" | "running" | "stopping" | "error";
  stateLabel: string;
  /** Название запущенной (или последней) команды. */
  command?: string;
  url?: string;
  /** Docker-окружение: образ и сеть. */
  docker?: string;
}
/** Подробности выбранного элемента: все действия, карточка проекта и последний сбой запуска. */
export interface LaunchDetail {
  actions: LaunchAction[];
  info?: LaunchInfo;
  failure?: { command: string; exitCode: number | null; output: string };
}
export interface LaunchResult {
  ok: boolean;
  /** Маршрут воркспейса для действия `open`. */
  route?: string;
  /** Новое состояние избранного после действия `favorite`. */
  favorite?: boolean;
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
    launch: (id: string, action?: LaunchActionId, inline = false, arg?: string) =>
      request<LaunchResult>("/api/launcher/launch", { id, action, inline, arg }),
    detail: (id: string, signal?: AbortSignal) =>
      request<LaunchDetail>(`/api/launcher/detail?id=${encodeURIComponent(id)}`, undefined, signal),
    /**
     * Server-sent `status` events about project processes. Uses fetch streaming so that the
     * browser and the native Node process share one implementation; reconnects until stopped.
     */
    subscribe(onStatus: () => void): () => void {
      const controller = new AbortController();
      void (async () => {
        while (!controller.signal.aborted) {
          try {
            const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
            if (!response.ok || !response.body) throw new Error(String(response.status));
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += value;
              let end: number;
              while ((end = buffer.indexOf("\n\n")) >= 0) {
                const block = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (/^event: status$/m.test(block)) onStatus();
              }
            }
          } catch {
            /* Retry below unless stopped. */
          }
          if (!controller.signal.aborted) await new Promise((done) => setTimeout(done, 2000));
        }
      })();
      return () => controller.abort();
    },
    hide: () => request<{ ok: boolean }>("/api/app/hide", {}),
    open: (toggle = false) => request<{ ok: boolean }>("/api/app/open", { toggle }),
    quit: () => request<{ ok: boolean }>("/api/app/quit", {}),
    restart: () => request<{ ok: boolean }>("/api/app/restart", {}),
  };
}
export type LauncherClient = ReturnType<typeof createLauncherClient>;
