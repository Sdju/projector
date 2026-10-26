import { pageClientId } from "../../../common/utilities/page-client.ts";
import { newId } from "../../../common/utilities/new-id.ts";
import type { AgentEvent } from "../model/types.ts";

/** The events stream of the page is not open: the answer has to come in the response instead. */
export const EVENTS_UNAVAILABLE = Symbol("events unavailable");

/** The server refused to start the answer; `status` tells why (404: the run to rejoin is gone). */
export class EventStreamRefused extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Starts an answer that the server delivers through the page's events stream (`/api/events`) and
 * resolves when it ends. The request returns at once, so a running answer holds no connection:
 * a browser allows few per origin for all its tabs. A reconnect of the events stream fails the
 * answer like a broken response, because events sent meanwhile are lost.
 */
export async function streamViaEvents(
  body: Record<string, unknown>,
  handle: (event: AgentEvent) => Promise<void>,
  signal?: AbortSignal,
): Promise<typeof EVENTS_UNAVAILABLE | undefined> {
  if (typeof window === "undefined") return EVENTS_UNAVAILABLE;
  const stream = newId();
  let finish!: (error?: unknown) => void;
  const ended = new Promise<void>((resolve, reject) => {
    finish = (error) => (error ? reject(error) : resolve());
  });
  // Events are handled one after another: a command request is answered before the next event.
  let chain: Promise<void> = Promise.resolve();
  const onAgent = (event: Event) => {
    const detail = (event as CustomEvent<{ stream: string; event: string; data: unknown }>).detail;
    if (detail.stream !== stream) return;
    if (detail.event === "end") {
      chain = chain.then(() => finish());
      return;
    }
    chain = chain.then(() => handle({ event: detail.event, data: detail.data } as AgentEvent));
    chain.catch(finish);
  };
  const onReopen = () => finish(new Error("Соединение с событиями прервано"));
  const onAbort = () => {
    void fetch("/api/agent/detach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stream }),
      keepalive: true,
    }).catch(() => {});
    finish(new DOMException("Aborted", "AbortError"));
  };
  window.addEventListener("projector:agent", onAgent);
  window.addEventListener("projector:events-open", onReopen);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, client: pageClientId, stream }),
      signal,
    });
    if (response.status === 409) return EVENTS_UNAVAILABLE;
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new EventStreamRefused(payload?.error || "Агент недоступен", response.status);
    }
    await ended;
    await chain;
  } finally {
    window.removeEventListener("projector:agent", onAgent);
    window.removeEventListener("projector:events-open", onReopen);
    signal?.removeEventListener("abort", onAbort);
  }
}
