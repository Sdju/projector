import {
  Agent,
  request,
  type IncomingMessage,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

/** One bounded tunnel stream per upstream connection; bodies and upgrades remain streams. */
export function forward(
  req: IncomingMessage,
  target: ServerResponse | Duplex,
  stream: Duplex,
  path: string,
  origin: string,
  head?: Buffer,
): void {
  const agent = new Agent({ keepAlive: false });
  agent.createConnection = () => stream as Socket;
  const headers: IncomingHttpHeaders = { ...req.headers, host: new URL(origin).host };
  for (const key of Object.keys(headers)) {
    if (
      key === "cookie" ||
      key === "forwarded" ||
      key.startsWith("x-forwarded-") ||
      key.startsWith("x-projector-hub")
    )
      delete headers[key];
  }
  const upstream = request({
    host: "hub-tunnel",
    port: 80,
    method: req.method,
    path,
    headers,
    agent,
  });
  let upgraded = false;
  const cleanup = () => {
    if (!upgraded) upstream.destroy();
    stream.destroy();
    agent.destroy();
  };
  target.once("close", cleanup);
  upstream.on("error", () => {
    if ("writeHead" in target) {
      if (!target.headersSent) target.writeHead(502, { "Content-Type": "application/json" });
      target.end(JSON.stringify({ error: "Соединение с устройством прервано" }));
    } else target.destroy();
    cleanup();
  });
  upstream.on("response", (response) => {
    if (!("writeHead" in target)) {
      response.resume();
      target.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      return;
    }
    const headers = { ...response.headers };
    delete headers["set-cookie"];
    headers["cache-control"] = "no-store";
    target.writeHead(response.statusCode ?? 502, headers);
    response.on("error", () => target.destroy());
    response.pipe(target);
  });
  upstream.on("upgrade", (response, socket, received) => {
    if ("writeHead" in target) {
      socket.destroy();
      target.destroy();
      return;
    }
    upgraded = true;
    const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      if (response.rawHeaders[i].toLowerCase() !== "set-cookie")
        lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
    }
    target.write(lines.join("\r\n") + "\r\n\r\n");
    if (received.length) target.write(received);
    if (head?.length) socket.write(head);
    socket.on("error", () => target.destroy());
    target.on("error", () => socket.destroy());
    socket.once("close", () => target.destroy());
    target.pipe(socket).pipe(target);
  });
  req.on("aborted", cleanup);
  req.pipe(upstream);
}
