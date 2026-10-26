import { EVENT_NAMES } from "./event-names.ts";

export type EventHandler = (name: string, data: string) => void;

function direct(clientId: string, handler: EventHandler): void {
  const source = new EventSource(`/api/events?client=${clientId}`);
  for (const name of EVENT_NAMES)
    source.addEventListener(name, (event) => handler(name, (event as MessageEvent).data));
  // After a reconnect the server has dropped this page's watchers and files may have changed meanwhile.
  source.addEventListener("open", () => handler("open", ""));
}

// Keep a page's protocol stable for its lifetime, like the terminal transport.
const shared =
  typeof SharedWorker !== "undefined" &&
  new URLSearchParams(location.search).get("eventsTransport") !== "legacy";

/**
 * Subscribes the page to the server events. All pages of the browser share one stream through a
 * SharedWorker; without one, or when it fails to start, the page opens its own stream.
 */
export function connectEvents(clientId: string, handler: EventHandler): void {
  if (!shared) return direct(clientId, handler);
  let ready = false;
  let fallback = false;
  const fail = () => {
    if (fallback) return;
    fallback = true;
    worker.port.close();
    direct(clientId, handler);
  };
  let worker: SharedWorker;
  try {
    worker = new SharedWorker(new URL("./events.worker.ts", import.meta.url), {
      type: "module",
      name: "projector-events-v1",
    });
  } catch {
    return direct(clientId, handler);
  }
  const timer = setTimeout(() => ready || fail(), 8000);
  worker.onerror = () => {
    clearTimeout(timer);
    fail();
  };
  worker.port.onmessage = (event) => {
    if (fallback) return;
    const message = event.data;
    if (message.type === "ready") {
      ready = true;
      clearTimeout(timer);
      worker.port.postMessage({ type: "join", page: clientId });
    } else if (message.type === "ping") worker.port.postMessage({ type: "pong" });
    else if (message.type === "event") handler(message.name, message.data);
  };
  worker.port.start();
  // pagehide also runs for bfcache: join again when the page resumes.
  globalThis.addEventListener("pagehide", () => worker.port.postMessage({ type: "leave" }));
  globalThis.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted && !fallback)
      worker.port.postMessage({ type: "join", page: clientId });
  });
}
