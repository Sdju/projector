/** Ошибка HTTP-запроса адаптера: статус ответа, сообщение сервера и его тело. */
export class WorkspaceRequestError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "WorkspaceRequestError";
    this.status = status;
    this.body = body;
  }
}

/** Читает действие browse-маршрута интеграции и превращает ошибочный ответ в общий тип. */
export type BrowseReader = <T>(
  action: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => Promise<T>;

/** Один и тот же разбор ответа для GitHub и GitLab: различается только префикс маршрута. */
export function createBrowseReader(prefix: string, failure: string): BrowseReader {
  return async function browse<T>(
    action: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${prefix}/${action}?${new URLSearchParams(params)}`, { signal });
    const body: unknown = await response.json();
    if (!response.ok) {
      const reason = (body as { error?: unknown } | null)?.error;
      throw new WorkspaceRequestError(
        typeof reason === "string" && reason ? reason : failure,
        response.status,
        body,
      );
    }
    return body as T;
  };
}
