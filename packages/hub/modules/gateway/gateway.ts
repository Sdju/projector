import { createServer } from "node:http";
import { HubAccess } from "../access/index.ts";
import { serveStatic } from "../static/index.ts";
import { Tunnels } from "./tunnels.ts";
import { forward } from "./forward.ts";

export interface HubOptions {
  origin: string;
  password: string;
  deviceToken: string;
  staticRoot: string;
  dataDir?: string;
}
const route = (path: string) => /^\/api\/devices\/([a-z0-9][a-z0-9-]{0,62})(\/.*)$/.exec(path);
export function createHub(options: HubOptions) {
  const publicUrl = new URL(options.origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname);
  if (
    publicUrl.origin !== options.origin ||
    (publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && local))
  )
    throw new Error("Для удалённого Hub требуется HTTPS origin");
  if (!options.password || !options.deviceToken || options.password === options.deviceToken)
    throw new Error("Hub требует разные credentials браузера и устройств");
  const access = new HubAccess(options.origin, options.password, options.dataDir);
  const tunnels = new Tunnels(options.deviceToken);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", options.origin);
      if (!access.trusted(req)) {
        res.writeHead(403).end();
        return;
      }
      if (url.pathname === "/api/hub/health") {
        res
          .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(JSON.stringify({ ok: true, app: "projector-hub" }));
        return;
      }
      if (
        /^\/(?:assets\/|icons\/|file-icons\/|favicon\.svg$|manifest\.webmanifest$|sw\.js$)/.test(
          url.pathname,
        )
      ) {
        await serveStatic(options.staticRoot, req, res);
        return;
      }
      if (url.pathname === "/api/hub/session") {
        if (req.method === "GET") {
          const authenticated = access.allow(req, res);
          res
            .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
            .end(JSON.stringify({ authenticated }));
        } else if (req.method === "POST") await access.login(req, res);
        else if (req.method === "DELETE") access.logout(req, res);
        else res.writeHead(405, { Allow: "GET, POST, DELETE" }).end();
        return;
      }
      if (url.pathname === "/api/hub/login-link") {
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" }).end();
          return;
        }
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const session = access.allow(req, res) && req.headers.origin === options.origin;
        if (!session && !tunnels.accepts(token)) {
          res
            .writeHead(access.allowed(req) ? 403 : 401, { "Content-Type": "application/json" })
            .end(
              JSON.stringify({
                error: access.allowed(req) ? "Нужен Origin Hub" : "Войдите в Projector Hub",
              }),
            );
          return;
        }
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(access.issueLoginLink()));
        return;
      }
      if (url.pathname === "/login") {
        if (req.method === "POST") await access.login(req, res, true);
        else if (req.method === "GET" || req.method === "HEAD")
          await serveStatic(options.staticRoot, req, res, "hub.html");
        else res.writeHead(405, { Allow: "GET, HEAD, POST" }).end();
        return;
      }
      if (!access.allow(req, res)) {
        if (url.pathname.startsWith("/api/"))
          res
            .writeHead(401, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "WWW-Authenticate": 'Session realm="Projector Hub"',
            })
            .end(JSON.stringify({ error: "Войдите в Projector Hub" }));
        else
          res
            .writeHead(303, {
              Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
              "Cache-Control": "no-store",
            })
            .end();
        return;
      }
      if (url.pathname === "/api/hub/device-token") {
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" }).end();
          return;
        }
        if (req.headers.origin !== options.origin) {
          res.writeHead(403).end();
          return;
        }
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ token: options.deviceToken }));
        return;
      }
      const match = route(url.pathname);
      if (match) {
        if (!tunnels.devices.has(match[1])) {
          res
            .writeHead(503, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: "Устройство недоступно" }));
          return;
        }
        const stream = await tunnels.open(match[1]);
        if (res.destroyed) {
          stream.destroy();
          return;
        }
        if (!access.track(req, res)) {
          stream.destroy();
          return;
        }
        forward(req, res, stream, `/api${match[2]}${url.search}`, options.origin);
        return;
      }
      if (url.pathname === "/api/hub/devices") {
        res
          .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(JSON.stringify({ devices: tunnels.list() }));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        res.writeHead(404).end();
        return;
      }
      if (url.pathname === "/") {
        await serveStatic(options.staticRoot, req, res, "hub.html");
        return;
      }
      await serveStatic(options.staticRoot, req, res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Не удалось связаться с устройством" }));
    });
  });
  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", options.origin);
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    socket.on("error", () => socket.destroy());
    if (url.pathname === "/api/hub/connect" && req.headers.host === new URL(options.origin).host) {
      tunnels.upgrade(req, socket, head);
      return;
    }
    const match = route(url.pathname);
    if (!match || !access.allowed(req) || req.headers.origin !== options.origin) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    void tunnels
      .open(match[1])
      .then((stream) => {
        if (socket.destroyed) {
          stream.destroy();
          return;
        }
        if (!access.track(req, socket)) {
          stream.destroy();
          return;
        }
        forward(req, socket, stream, `/api${match[2]}${url.search}`, options.origin, head);
      })
      .catch(() => socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"));
  });
  tunnels.bind(server);
  return {
    server,
    close: () => {
      access.close();
      tunnels.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
