import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { hubReturnPath } from "../packages/core/modules/hub/index.ts";
import { HubAccess } from "../packages/hub/modules/access/index.ts";
import { createHub } from "../packages/hub/modules/gateway/index.ts";
import { connectHub } from "../packages/server/modules/hub/connector.ts";
import { accessAllowed, isLocalRequest } from "../packages/server/modules/access/index.ts";
import { deviceUrl, deviceBase } from "../packages/client/common/utilities/device-url.ts";

const cleanups = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "projector-hub-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.html"), "<title>Hub owns this interface</title>");
  await writeFile(join(root, "hub.html"), '<title>Projector Hub shell</title><div id="app"></div>');
  // Reserve the final origin before accepting device connections.
  const hub = createHub({
    origin: "http://localhost:1",
    password: "browser-secret",
    deviceToken: "device-secret",
    staticRoot: root,
  });
  await new Promise((resolve) => hub.server.listen(0, "127.0.0.1", resolve));
  const port = hub.server.address().port;
  hub.close();
  const origin = `http://localhost:${port}`;
  const active = createHub({
    origin,
    password: "browser-secret",
    deviceToken: "device-secret",
    staticRoot: root,
  });
  await new Promise((resolve) => active.server.listen(port, "127.0.0.1", resolve));
  cleanups.push(() => active.close());
  let sequence = 0;
  const stop = connectHub(
    { url: origin, deviceId: "desk", token: "device-secret" },
    {
      handle(req, res) {
        if (!accessAllowed(req, false)) {
          res.writeHead(403).end();
          return;
        }
        if (req.url === "/api/local-only") {
          res.writeHead(isLocalRequest(req) ? 200 : 403).end();
          return;
        }
        if (req.url === "/api/events") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: first\n\n");
          const timer = setTimeout(() => res.end("data: second\n\n"), 200);
          res.once("close", () => clearTimeout(timer));
          return;
        }
        if (req.url === "/api/upload") {
          let bytes = 0;
          req.on("data", (chunk) => (bytes += chunk.length));
          req.on("end", () => res.end(String(bytes)));
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            path: req.url,
            local: isLocalRequest(req),
            sequence: ++sequence,
            forwarded: req.headers["x-forwarded-for"] ?? null,
            cookie: req.headers.cookie ?? null,
          }),
        );
      },
      attach(server) {
        const sockets = new WebSocketServer({ noServer: true });
        server.on("upgrade", (req, socket, head) => {
          if (!accessAllowed(req, true)) {
            socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
          }
          sockets.handleUpgrade(req, socket, head, (ws) =>
            ws.on("message", (data) => ws.send(data)),
          );
        });
        return () => {
          for (const ws of sockets.clients) ws.terminate();
          sockets.close();
        };
      },
    },
    () => {},
  );
  cleanups.push(stop);
  const login = await fetch(`${origin}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: "password=browser-secret",
    redirect: "manual",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  for (let i = 0; i < 100; i++) {
    const list = await fetch(`${origin}/api/hub/devices`, { headers: { Cookie: cookie } }).then(
      (res) => res.json(),
    );
    if (list.devices.length) return { origin, cookie, stop };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Connector did not register");
}

describe("Hub reverse connection", () => {
  test("serves its own UI, authenticates and routes to a remote-context device", async () => {
    const { origin, cookie } = await setup();
    expect((await fetch(`${origin}/api/devices/desk/projects`)).status).toBe(401);
    await expect(
      (await fetch(`${origin}/devices/desk/`, { headers: { Cookie: cookie } })).text(),
    ).resolves.toContain("Hub owns this interface");
    const response = await fetch(`${origin}/api/devices/desk/projects?path=a%2Fb`, {
      headers: { Cookie: cookie, "X-Forwarded-For": "127.0.0.1" },
    });
    expect(await response.json()).toMatchObject({
      path: "/api/projects?path=a%2Fb",
      local: false,
      forwarded: null,
      cookie: null,
    });
    expect(
      (await fetch(`${origin}/api/devices/desk/local-only`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/devices/desk/projects`, {
          headers: { Cookie: cookie, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${origin}/api/devices/missing/projects`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(503);
  });
  test("streams SSE before completion, transfers binary bodies and upgrades WebSocket", async () => {
    const { origin, cookie } = await setup();
    const response = await fetch(`${origin}/api/devices/desk/events`, {
      headers: { Cookie: cookie },
    });
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: second\n\n");
    await reader.cancel();
    const upload = await fetch(`${origin}/api/devices/desk/upload`, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: Buffer.alloc(2 * 1024 * 1024, 0xa5),
    });
    expect(await upload.text()).toBe(String(2 * 1024 * 1024));
    const ws = new WebSocket(`${origin.replace("http", "ws")}/api/devices/desk/terminal/socket`, {
      headers: { Cookie: cookie, Origin: origin },
    });
    cleanups.push(() => ws.terminate());
    await once(ws, "open");
    const message = once(ws, "message");
    ws.send("hello terminal");
    expect((await message)[0].toString()).toBe("hello terminal");
    ws.close();
    await once(ws, "close");
  });
  test("rejects wrong connector credentials and reports disconnect", async () => {
    const { origin, cookie, stop } = await setup();
    const ws = new WebSocket(
      `${origin.replace("http", "ws")}/api/hub/connect?device=intruder&protocol=1`,
      { headers: { Authorization: "Bearer wrong" } },
    );
    expect(
      await new Promise((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode);
          res.resume();
          ws.terminate();
        });
        ws.on("error", () => {});
      }),
    ).toBe(401);
    stop();
    for (let i = 0; i < 100; i++) {
      const list = await fetch(`${origin}/api/hub/devices`, { headers: { Cookie: cookie } }).then(
        (res) => res.json(),
      );
      if (list.devices.every((device) => !device.online)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      (await fetch(`${origin}/api/devices/desk/projects`, { headers: { Cookie: cookie } })).status,
    ).toBe(503);
  });
});

test("device transport isolates page URLs and preserves local/external requests", () => {
  vi.stubGlobal("location", new URL("https://hub.example/devices/desk/projects/demo"));
  expect(deviceBase()).toBe("/devices/desk");
  expect(deviceUrl("/api/projects?x=1")).toBe("/api/devices/desk/projects?x=1");
  expect(deviceUrl("wss://hub.example/api/terminal/control")).toBe(
    "wss://hub.example/api/devices/desk/terminal/control",
  );
  expect(deviceUrl("/api/devices/desk/projects")).toBe("/api/devices/desk/projects");
  expect(deviceUrl("https://other.example/api/projects")).toBe(
    "https://other.example/api/projects",
  );
  vi.stubGlobal("location", new URL("http://localhost:4177/"));
  expect(deviceUrl("/api/projects")).toBe("/api/projects");
});

test("Hub serves a public Vue shell, returns JSON login errors and revokes live sockets on logout", async () => {
  const { origin, cookie } = await setup();
  const shell = await fetch(`${origin}/login`).then((response) => response.text());
  expect(shell).toContain("Projector Hub shell");
  expect(shell).not.toContain("<form");
  expect(await fetch(`${origin}/api/hub/session`).then((r) => r.json())).toEqual({
    authenticated: false,
  });
  const bad = await fetch(`${origin}/api/hub/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  });
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ error: "Неверный пароль" });
  const protectedPage = await fetch(`${origin}/devices/desk/projects/demo?ref=main`, {
    redirect: "manual",
  });
  expect(protectedPage.headers.get("location")).toBe(
    "/login?next=%2Fdevices%2Fdesk%2Fprojects%2Fdemo%3Fref%3Dmain",
  );
  const ws = new WebSocket(`${origin.replace("http", "ws")}/api/devices/desk/terminal/socket`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  cleanups.push(() => ws.terminate());
  await once(ws, "open");
  const closed = once(ws, "close");
  const response = await fetch(`${origin}/api/hub/session`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  await closed;
  const refused = await fetch(`${origin}/api/devices/desk/projects`, {
    headers: { Cookie: cookie },
  });
  expect(refused.status).toBe(401);
  expect(refused.headers.get("www-authenticate")).toBe('Session realm="Projector Hub"');
});

test("session expiry closes its live connections and never grants access to other sessions", async () => {
  vi.useFakeTimers();
  const access = new HubAccess("http://localhost:4180", "secret");
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead() {
      return this;
    },
    end() {},
  };
  const req = {
    headers: { host: "localhost:4180", "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify({ password: "secret" });
    },
  };
  await access.login(req, response);
  req.headers.cookie = response.headers["Set-Cookie"].split(";")[0];
  const destroy = vi.fn();
  const connection = { destroy, once() {} };
  expect(access.track(req, connection)).toBe(true);
  expect(access.allowed(req)).toBe(true);
  await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000 + 1);
  expect(access.allowed(req)).toBe(false);
  access.close();
  expect(destroy).toHaveBeenCalledOnce();
});

test.each([
  "https://evil.example",
  "//evil.example",
  "/devices/desk/../../login",
  "/devices/desk/..\\evil",
  "/login",
])("post-login return path rejects %s", (value) => {
  expect(hubReturnPath(value)).toBe("/");
});
test("post-login return path preserves device, query and fragment", () => {
  expect(hubReturnPath("/devices/desk/projects/demo?ref=main#file")).toBe(
    "/devices/desk/projects/demo?ref=main#file",
  );
});
