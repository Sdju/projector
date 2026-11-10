import type {
  InterfaceMode,
  LaunchActionId,
  LaunchItem,
  LaunchResult,
} from "@projector-ai/core/modules/launcher/index.ts";
import type { ProcessSnapshot, Project } from "@projector-ai/core/modules/project/index.ts";

export interface HealthInfo {
  ok: true;
  app: "projector";
  pid: number;
  url?: string;
  mode?: string;
  network?: {
    mode?: string;
    passwordRequired?: boolean;
    lanUrl?: string | null;
  };
}

export interface AppOpenRequest {
  tray?: boolean;
  mode?: InterfaceMode;
  toggle?: boolean;
  route?: string;
}

export interface AppOpenResult {
  ok: boolean;
  url?: string;
  mode?: InterfaceMode;
}

export interface LaunchRequest {
  id: string;
  action?: LaunchActionId;
  inline?: boolean;
  arg?: string;
}

export type LaunchResponse = LaunchResult;

export interface ProjectsResponse {
  projects: Project[];
}

export interface SearchResponse {
  items: LaunchItem[];
  warning?: string;
}

export interface RuntimeResponse {
  runtime: ProcessSnapshot;
}

export interface AppActionResult {
  ok: boolean;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

export interface ProjectorApi {
  baseUrl: string;
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  health(): Promise<HealthInfo | null>;
  projects(): Promise<ProjectsResponse>;
  search(query: string): Promise<SearchResponse>;
  launch(body: LaunchRequest): Promise<LaunchResponse>;
  open(body: AppOpenRequest): Promise<AppOpenResult>;
  start(projectId: string, body: { commandId?: string }): Promise<RuntimeResponse>;
  stop(projectId: string): Promise<RuntimeResponse>;
  app(action: "restart" | "quit", body?: unknown): Promise<AppActionResult>;
}

/** Minimal client for the local Projector server. No retries: the CLI already starts it. */
export function createApi(baseUrl: string): ProjectorApi {
  async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, timeout = 15_000 } = options;
    const response = await fetch(baseUrl + path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = { error: text };
      }
    }
    if (!response.ok) {
      const error =
        data && typeof data === "object" && "error" in data
          ? (data as { error?: unknown }).error
          : undefined;
      throw new Error(
        typeof error === "string" && error ? error : `Ошибка запроса (${response.status})`,
      );
    }
    return data as T;
  }

  async function health(): Promise<HealthInfo | null> {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      const data = (await response.json()) as Partial<HealthInfo>;
      return response.ok && data.ok === true && data.app === "projector"
        ? (data as HealthInfo)
        : null;
    } catch {
      return null;
    }
  }

  return {
    baseUrl,
    request,
    health,
    projects: () => request<ProjectsResponse>("/api/projects"),
    search: (query) =>
      request<SearchResponse>(`/api/launcher/search?${new URLSearchParams({ q: query })}`),
    launch: (body) => request<LaunchResponse>("/api/launcher/launch", { method: "POST", body }),
    open: (body) => request<AppOpenResult>("/api/app/open", { method: "POST", body }),
    start: (projectId, body) =>
      request<RuntimeResponse>(`/api/projects/${encodeURIComponent(projectId)}/start`, {
        method: "POST",
        body,
      }),
    stop: (projectId) =>
      request<RuntimeResponse>(`/api/projects/${encodeURIComponent(projectId)}/stop`, {
        method: "POST",
      }),
    app: (action, body = {}) =>
      request<AppActionResult>(`/api/app/${action}`, { method: "POST", body }),
  };
}
