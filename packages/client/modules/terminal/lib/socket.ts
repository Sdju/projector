/** WebSocket-compatible surface used by both the legacy and shared transports. */
export interface TerminalSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}
let worker: SharedWorker | undefined;
const channels = new Map<string, SharedSocket>();
function releaseWorker() {
  worker?.port.postMessage({ type: "release" });
  worker?.port.close();
  worker = undefined;
}
function port(): MessagePort {
  if (!worker) {
    worker = new SharedWorker(new URL("./shared.worker.ts", import.meta.url), {
      type: "module",
      name: "projector-terminals-v1",
    });
    const current = worker;
    worker.port.onmessage = (event) => {
      if (worker !== current) return;
      const message = event.data;
      if (message.type === "ping") {
        worker?.port.postMessage({ type: "pong" });
        return;
      }
      const channel = channels.get(message.channel);
      if (!channel) return;
      if (message.type === "opened") channel.opened();
      else if (message.type === "message") {
        worker?.port.postMessage({
          type: "received",
          channel: message.channel,
          length: message.data.length,
        });
        channel.onmessage?.(new MessageEvent("message", { data: message.data }));
      } else if (message.type === "closed") {
        // Only worker/transport failures (1006, 1008) justify the legacy socket; a code from the
        // server is a real answer and legacy would just repeat the request and hide the code.
        channel.ended(message.code, message.code === 1006 || message.code === 1008);
      }
    };
    worker.onerror = () => {
      if (worker !== current) return;
      const affected = [...channels.values()];
      releaseWorker();
      for (const channel of affected) channel.ended(1006);
    };
    worker.port.start();
  }
  return worker.port;
}
class SharedSocket implements TerminalSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: TerminalSocket["onmessage"] = null;
  onclose: TerminalSocket["onclose"] = null;
  private fallback?: WebSocket;
  private timer: ReturnType<typeof setTimeout>;
  private wasOpened = false;
  // getRandomValues also exists in HTTP LAN contexts where randomUUID may be absent.
  private readonly id = crypto.getRandomValues(new Uint32Array(4)).join("-");
  private readonly url: URL;
  constructor(url: URL) {
    this.url = url;
    channels.set(this.id, this);
    this.timer = setTimeout(() => this.ended(1006), 8000);
    try {
      port().postMessage({
        type: "open",
        channel: this.id,
        url: url.href,
        projectId: url.searchParams.get("project"),
        sessionId: url.searchParams.get("session") ?? undefined,
      });
    } catch {
      queueMicrotask(() => this.ended(1006));
    }
  }
  opened() {
    if (this.readyState !== WebSocket.CONNECTING) return;
    clearTimeout(this.timer);
    this.wasOpened = true;
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }
  ended(code: number, allowFallback = true) {
    if (this.readyState === WebSocket.CLOSED || this.fallback) return;
    clearTimeout(this.timer);
    this.detach();
    // Only fall back before opening: no command or input has been sent yet.
    if (!this.wasOpened && allowFallback) {
      console.warn("Shared terminal transport unavailable; using legacy WebSocket");
      const socket = (this.fallback = new WebSocket(this.url));
      socket.onopen = () => this.opened();
      socket.onmessage = (event) => this.onmessage?.(event);
      socket.onclose = (event) => {
        this.readyState = WebSocket.CLOSED;
        this.onclose?.(event);
      };
      return;
    }
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code }));
  }
  private detach() {
    worker?.port.postMessage({ type: "close", channel: this.id });
    channels.delete(this.id);
    if (!channels.size) releaseWorker();
  }
  send(data: string) {
    if (this.readyState !== WebSocket.OPEN) return;
    if (this.fallback) this.fallback.send(data);
    else worker?.port.postMessage({ type: "send", channel: this.id, data });
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    clearTimeout(this.timer);
    this.detach();
    this.readyState = WebSocket.CLOSED;
    // Like WebSocket, report the close asynchronously so owners that reconnect from onclose recover.
    // With a fallback socket its own onclose reports it.
    if (this.fallback) this.fallback.close();
    else queueMicrotask(() => this.onclose?.(new CloseEvent("close", { code: 1005 })));
  }
}
// Keep a page's protocol stable for its lifetime; no migration of live terminals on HMR.
const shared =
  typeof SharedWorker !== "undefined" &&
  new URLSearchParams(location.search).get("terminalTransport") !== "legacy";
export function openTerminalSocket(url: URL): TerminalSocket {
  return shared ? new SharedSocket(url) : new WebSocket(url);
}
// pagehide also runs for bfcache: reconnect through existing owners when the page resumes.
globalThis.addEventListener?.("pagehide", () => {
  for (const channel of [...channels.values()]) channel.ended(1001, false);
  releaseWorker();
});
