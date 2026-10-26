/**
 * One `/api/events` stream for every Projector page on this origin: Chrome allows six HTTP/1.1
 * connections per origin for all tabs together, and a stream per tab starves ordinary requests.
 */
import { EVENT_NAMES } from "./event-names.ts";

interface Page {
  id: string;
  seen: number;
  live: boolean;
}
const pages = new Map<MessagePort, Page>();
const stream = crypto.getRandomValues(new Uint32Array(4)).join("-");
let source: EventSource | undefined;
let opened = false;

function sync(add: string[], remove: string[]): Promise<boolean> {
  if (!add.length && !remove.length) return Promise.resolve(true);
  return fetch("/api/events/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream, add, remove }),
    keepalive: true,
  }).then(
    (response) => response.ok,
    () => false,
  );
}
const live = () => [...pages.values()].filter((page) => page.live).map((page) => page.id);
const broadcast = (message: unknown) => {
  for (const [port, page] of pages) if (page.live) port.postMessage(message);
};

function start() {
  if (source) return;
  const current = (source = new EventSource(`/api/events?client=${stream}`));
  for (const name of EVENT_NAMES)
    current.addEventListener(name, (event) =>
      broadcast({ type: "event", name, data: (event as MessageEvent).data }),
    );
  // A new connection has no pages: bind them again before the pages resynchronise on `open`.
  current.addEventListener("open", () => {
    opened = true;
    void sync(live(), []).then(() => broadcast({ type: "event", name: "open", data: "" }));
  });
  current.addEventListener("error", () => {
    opened = false;
  });
}

function drop(port: MessagePort, page: Page, forget: boolean) {
  const wasLive = page.live;
  page.live = false;
  if (forget) pages.delete(port);
  if (wasLive) void sync([], [page.id]);
  if (!live().length && !pages.size) {
    source?.close();
    source = undefined;
    opened = false;
  }
}

function revive(port: MessagePort, page: Page) {
  page.live = true;
  start();
  if (opened)
    void sync([page.id], []).then(() =>
      port.postMessage({ type: "event", name: "open", data: "" }),
    );
}

const scope = self as unknown as { onconnect: (event: MessageEvent) => void };
scope.onconnect = (event) => {
  const port = event.ports[0]!;
  port.onmessage = (event) => {
    const message = event.data;
    const page = pages.get(port);
    if (message.type === "join" && typeof message.page === "string") {
      if (page) return;
      const joined = { id: message.page, seen: Date.now(), live: false };
      pages.set(port, joined);
      revive(port, joined);
      return;
    }
    if (!page) return;
    page.seen = Date.now();
    if (message.type === "leave") {
      drop(port, page, true);
    } else if (message.type === "pong" && !page.live) {
      // A frozen page woke up after being released: its watchers are gone, `open` resyncs them.
      revive(port, page);
    }
  };
  port.start();
  port.postMessage({ type: "ready" });
};
setInterval(() => {
  for (const [port, page] of pages) {
    if (Date.now() - page.seen > 120000) drop(port, page, false);
    else port.postMessage({ type: "ping" });
  }
}, 15000);
