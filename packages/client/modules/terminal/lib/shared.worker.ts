/** One pair of physical sockets for every Projector page on this origin. */
type Open = { type: "open"; channel: string; projectId: string; sessionId?: string; url: string };
type Consumer = {
  port: MessagePort;
  open: Open;
  kind: "control" | "data";
  opened: boolean;
  pending: number;
};
const consumers = new Map<string, Consumer>();
const ports = new Map<MessagePort, number>();
const links = new Map<string, WebSocket>();
const post = (consumer: Consumer, message: unknown) => consumer.port.postMessage(message);
function remove(channel: string, notify = false, code = 1006) {
  const consumer = consumers.get(channel);
  if (!consumer) return;
  consumers.delete(channel);
  const socket = links.get(consumer.kind);
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "close", channel }));
  if (notify) post(consumer, { type: "closed", channel, code });
  if (![...consumers.values()].some((item) => item.kind === consumer.kind)) {
    links.delete(consumer.kind);
    socket?.close();
  }
}
function open(port: MessagePort, message: Open) {
  if (consumers.has(message.channel)) return;
  const original = new URL(message.url);
  const kind = original.pathname.endsWith("/control") ? "control" : "data";
  const url = new URL("/api/terminal/shared", original);
  url.searchParams.set("kind", kind);
  const token = original.searchParams.get("token");
  if (token) url.searchParams.set("token", token);
  let socket = links.get(kind);
  // Never combine consumers with different credentials on an authenticated connection.
  if (socket && socket.url !== url.href) {
    port.postMessage({ type: "closed", channel: message.channel, code: 1008 });
    return;
  }
  consumers.set(message.channel, { port, open: message, kind, opened: false, pending: 0 });
  const subscribe = (target: WebSocket, request: Open) =>
    target.send(JSON.stringify({ ...request, url: undefined }));
  if (!socket) {
    socket = new WebSocket(url);
    links.set(kind, socket);
    const current = socket;
    current.onopen = () => {
      if (links.get(kind) !== current) return;
      for (const item of consumers.values()) if (item.kind === kind) subscribe(current, item.open);
    };
    current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const consumer = consumers.get(message.channel);
      if (!consumer || consumer.kind !== kind) return;
      if (message.type === "opened") consumer.opened = true;
      if (message.type === "message") {
        consumer.pending += message.data.length;
        if (consumer.pending > 2 * 1024 * 1024) {
          remove(message.channel, true, 1013);
          return;
        }
      }
      post(consumer, message);
      if (message.type === "closed") remove(message.channel);
    };
    current.onclose = () => {
      if (links.get(kind) !== current) return;
      links.delete(kind);
      // Report loss to existing reconnect logic. Never replay input or mutations.
      for (const [channel, item] of [...consumers]) if (item.kind === kind) remove(channel, true);
    };
    current.onerror = () => current.close();
  } else if (socket.readyState === WebSocket.OPEN) subscribe(socket, message);
}

const scope = self as unknown as { onconnect: (event: MessageEvent) => void };
scope.onconnect = (event) => {
  const port = event.ports[0]!;
  ports.set(port, Date.now());
  port.onmessage = (event) => {
    ports.set(port, Date.now());
    const message = event.data;
    if (message.type === "pong") return;
    if (message.type === "release") {
      for (const [channel, item] of [...consumers]) if (item.port === port) remove(channel);
      ports.delete(port);
      port.close();
      return;
    }
    if (message.type === "open") {
      open(port, message);
      return;
    }
    const consumer = consumers.get(message.channel);
    if (!consumer || consumer.port !== port) return;
    if (message.type === "received") {
      consumer.pending = Math.max(0, consumer.pending - message.length);
      return;
    }
    if (message.type === "close") {
      remove(message.channel);
      return;
    }
    const socket = links.get(consumer.kind);
    if (message.type === "send" && consumer.opened && socket?.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 1024 * 1024) {
        remove(message.channel, true, 1013);
        return;
      }
      socket.send(JSON.stringify(message));
    }
  };
  port.start();
  port.postMessage({ type: "ready" });
};
setInterval(() => {
  for (const [port, lastSeen] of ports) {
    if (Date.now() - lastSeen > 120000) {
      // Leave the port able to deliver queued close notifications after a frozen page resumes.
      // Its owners then reconnect; silently closing the port would leave OPEN channels stranded.
      for (const [channel, item] of [...consumers]) if (item.port === port) remove(channel, true);
      ports.delete(port);
    } else port.postMessage({ type: "ping" });
  }
}, 15000);
