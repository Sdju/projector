import {
  agentCommandHandler,
  commandIsSafe,
  type AgentCommandCall,
  type createCommandService,
} from "../../../core/modules/ide/index.ts";
import { pageClientId } from "../../common/utilities/page-client.ts";

interface IdeCommandEvent {
  id: string;
  session: string;
  projectId: string;
  request: AgentCommandCall;
  owner?: string;
  fallbackAt: number;
  expiresAt: number;
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const aborted = () => {
  const error = new Error("Запрос IDE истёк");
  error.name = "AbortError";
  return error;
};

/** Waits for another page's grace period, but wakes up when the request is cancelled. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Stops waiting when the deadline passes; the command itself also gets the signal. */
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    if (signal.aborted) return cancel();
    signal.addEventListener("abort", cancel, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

/**
 * The page side of the built-in IDE MCP server: an external agent asks for a command, the page
 * that owns its MCP session claims the request, asks before a changing command and answers with
 * the live registry's result. The deadline comes from the server, so a confirmation that took too
 * long never runs the command after the agent was told the request expired.
 */
export function listenIdeCommands(api: ReturnType<typeof createCommandService>): () => void {
  const controllers = new Map<string, AbortController>();

  const answer = async (event: IdeCommandEvent) => {
    const controller = new AbortController();
    controllers.set(event.id, controller);
    const expiresAt = Number.isFinite(event.expiresAt) ? event.expiresAt : Date.now() + 60_000;
    const timer = setTimeout(() => controller.abort(), Math.max(0, expiresAt - Date.now()));
    const expired = () => controller.signal.aborted || Date.now() >= expiresAt;
    try {
      if (expired()) return;
      // The owner answers at once; another tab waits for its grace period before taking over.
      if (event.owner && event.owner !== pageClientId && event.fallbackAt > Date.now()) {
        await pause(event.fallbackAt - Date.now(), controller.signal);
        if (expired()) return;
      }
      const claim = await post("/api/ide/command-request/claim", {
        id: event.id,
        page: pageClientId,
      });
      const claimed = claim.ok && (await claim.json()).claimed === true;
      if (!claimed || expired()) return;

      const request = event.request;
      if (request.operation === "execute" && request.command && !commandIsSafe(request.command)) {
        const described = request.scope
          ? api.describeCommand(request.scope, request.command, request.args)
          : undefined;
        const args = request.args ? JSON.stringify(request.args, null, 2) : "";
        const detail = [described?.title ?? request.command, request.command, args]
          .filter(Boolean)
          .join("\n");
        if (!window.confirm(`Агент хочет выполнить команду Projector:\n\n${detail}`))
          throw new Error("Пользователь отклонил действие");
        if (expired()) return;
      }
      const output = await untilAbort(
        agentCommandHandler(api, event.projectId)(request, controller.signal),
        controller.signal,
      );
      if (expired()) return;
      await post("/api/ide/command-request/result", {
        id: event.id,
        page: pageClientId,
        output,
      });
    } catch (error) {
      // After the deadline the server has already removed the request and told the agent.
      if (expired()) return;
      await post("/api/ide/command-request/result", {
        id: event.id,
        page: pageClientId,
        error: error instanceof Error ? error.message : "Не удалось выполнить команду",
      }).catch(() => undefined);
    } finally {
      clearTimeout(timer);
      controllers.delete(event.id);
    }
  };

  const onRequest = (event: Event) => {
    const detail = (event as CustomEvent<IdeCommandEvent>).detail;
    if (!detail?.id || !detail.projectId) return;
    if (!api.getScopes().some(({ context }) => context.projectId === detail.projectId)) return;
    void answer(detail);
  };
  const onCancel = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string }>).detail;
    if (detail?.id) controllers.get(detail.id)?.abort();
  };
  window.addEventListener("projector:ide-command-request", onRequest);
  window.addEventListener("projector:ide-command-cancel", onCancel);
  return () => {
    window.removeEventListener("projector:ide-command-request", onRequest);
    window.removeEventListener("projector:ide-command-cancel", onCancel);
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  };
}
