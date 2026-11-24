import { addAbortListener } from "node:events";
import {
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import type { HttpServer } from "vite-plus";
import { accessAllowed, isLocalRequest } from "../access/index.ts";
import { hubRelayConnection } from "./hub.ts";

const devicePath = /^\/api\/devices\/[a-z0-9][a-z0-9-]{0,62}\//;
const RELAY_HEADERS_TIMEOUT_MS = 30_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade",
]);

function relay(req: IncomingMessage, target: ServerResponse | Duplex, head?: Buffer): void {
  const response = "writeHead" in target ? target : undefined;
  const fail = (status: number, message: string) => {
    if (target.destroyed) return;
    if (response) {
      if (response.headersSent) response.destroy();
      else
        response
          .writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(JSON.stringify({ error: message }));
    } else {
      target.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    }
  };
  const requireOrigin = !response || !["GET", "HEAD"].includes(req.method ?? "");
  if (!isLocalRequest(req) || !accessAllowed(req, requireOrigin)) {
    fail(403, "Forbidden");
    return;
  }
  const connection = hubRelayConnection();
  if (!connection) {
    fail(503, "Hub unavailable");
    return;
  }
  const { config, signal } = connection;
  const path = new URL(req.url ?? "/", "http://localhost");
  const url = new URL(config.url);
  url.pathname = path.pathname;
  url.search = path.search;
  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (
      ["host", "authorization", "cookie", "referer", "forwarded"].includes(name) ||
      (!head && HOP_BY_HOP_HEADERS.has(name)) ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("x-projector-hub")
    )
      delete headers[name];
  }
  if (headers.origin) headers.origin = config.url;
  headers["x-projector-hub-relay"] = config.token;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  // Disable keep-alive pooling so a stale socket closed by an upstream proxy cannot ECONNRESET a POST.
  const upstream = request(url, { method: req.method, headers, agent: false });
  const abort = addAbortListener(signal, () => target.destroy());
  target.once("close", () => {
    abort[Symbol.dispose]();
    upstream.destroy();
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    upstream.destroy();
  }, RELAY_HEADERS_TIMEOUT_MS);
  timeout.unref();
  upstream.on("error", () => {
    clearTimeout(timeout);
    fail(timedOut ? 504 : 502, timedOut ? "Hub request timed out" : "Hub connection failed");
  });
  upstream.on("response", (incoming) => {
    clearTimeout(timeout);
    if (!response) {
      incoming.resume();
      fail(incoming.statusCode ?? 502, "Hub upgrade failed");
      return;
    }
    const headers = { ...incoming.headers };
    delete headers["set-cookie"];
    // A stale relay must surface the failure in the local UI instead of triggering Hub login.
    if (headers["www-authenticate"] === 'Session realm="Projector Hub"')
      delete headers["www-authenticate"];
    response.writeHead(incoming.statusCode ?? 502, headers);
    incoming.on("error", () => response.destroy());
    response.once("close", () => incoming.destroy());
    incoming.pipe(response);
  });
  upstream.on("upgrade", (incoming, socket, buffered) => {
    clearTimeout(timeout);
    if (response) {
      socket.destroy();
      fail(502, "Unexpected Hub upgrade");
      return;
    }
    const lines = [`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}`];
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
      if (incoming.rawHeaders[i]?.toLowerCase() !== "set-cookie")
        lines.push(`${incoming.rawHeaders[i]}: ${incoming.rawHeaders[i + 1]}`);
    }
    target.write(lines.join("\r\n") + "\r\n\r\n");
    if (buffered.length) target.write(buffered);
    if (head?.length) socket.write(head);
    socket.on("error", () => target.destroy());
    socket.once("close", () => target.destroy());
    target.on("error", () => socket.destroy());
    target.once("close", () => socket.destroy());
    target.pipe(socket).pipe(target);
  });
  req.once("aborted", () => upstream.destroy());
  if (head) upstream.end();
  else req.pipe(upstream);
}

export function handleHubRelay(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (!devicePath.test(path)) return false;
  relay(req, res);
  return true;
}

export function attachHubRelay(server: Server | HttpServer): () => void {
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (devicePath.test(req.url ?? "")) relay(req, socket, head);
  };
  server.on("upgrade", upgrade);
  return () => server.off("upgrade", upgrade);
}
