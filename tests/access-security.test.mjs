import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, chmod, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import {
  accessAllowed,
  authorizeHttp,
  setLanPassword,
  hasLanPassword,
} from "../server/modules/access/index.ts";
import { lanPasswordPath } from "../core/modules/app-paths/index.ts";
import { handleApi } from "../server/app/api.ts";
import { attachTerminalServer } from "../server/modules/terminal/index.ts";
import { attachTerminalControlServer } from "../server/modules/terminal-control/index.ts";
import { updateProjects } from "../server/modules/projects/index.ts";
import { WebSocket } from "ws";

async function isolatedLan(t) {
  const dir = await mkdtemp("/tmp/projector-access-security-");
  const previous = { data: process.env.XDG_DATA_HOME, network: process.env.PROJECTOR_NETWORK };
  process.env.XDG_DATA_HOME = dir;
  process.env.PROJECTOR_NETWORK = "lan";
  t.after(async () => {
    for (const [key, value] of [
      ["XDG_DATA_HOME", previous.data],
      ["PROJECTOR_NETWORK", previous.network],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  setLanPassword("test-only-password");
  return dir;
}

function fakeRequest(host = "127.0.0.1:4177", address = "192.0.2.10", headers = {}) {
  return { headers: { host, ...headers }, socket: { remoteAddress: address } };
}

function send(server, hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port: server.address().port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (data) => {
        body += data;
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function listen(t, server) {
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return server;
}

test("LAN cannot turn attacker-controlled Host/Origin into local authority", async (t) => {
  await isolatedLan(t);
  for (const host of [
    "attacker.invalid:4177",
    "user@localhost:4177",
    "localhost:4177/path",
    "[",
    "",
  ]) {
    const req = fakeRequest(host, "127.0.0.1", { origin: `http://${host}` });
    assert.equal(accessAllowed(req, false), false, host);
  }
  assert.equal(
    accessAllowed(
      fakeRequest("127.0.0.1:4177", "127.0.0.1", { origin: "https://attacker.invalid" }),
      false,
    ),
    false,
  );
});

test("corrupt credentials fail closed, and replacing a password restores file permissions", async (t) => {
  await isolatedLan(t);
  const req = fakeRequest("192.0.2.1:4177", "192.0.2.10", { authorization: "Bearer arbitrary" });
  for (const data of ["", "corrupt", "ab:zz", "a".repeat(32) + ":" + "a".repeat(2)]) {
    await writeFile(lanPasswordPath(), data);
    assert.throws(hasLanPassword, /Повреждён/);
    assert.equal(accessAllowed(req, false), false);
    assert.equal(accessAllowed(fakeRequest(), false), false);
  }
  await rm(lanPasswordPath());
  await mkdir(lanPasswordPath());
  assert.equal(accessAllowed(fakeRequest(), false), false, "unreadable credential path");
  await rm(lanPasswordPath(), { recursive: true });
  setLanPassword("test-only-password");
  await chmod(lanPasswordPath(), 0o644);
  setLanPassword("replacement");
  assert.equal((await stat(lanPasswordPath())).mode & 0o777, 0o600);
});

test("fetch never attaches the LAN password to network-path or cross-origin URLs", async (t) => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = [];
  globalThis.window = { location: { origin: "http://localhost:4177" } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
    return new Response("{}");
  };
  t.after(() => {
    globalThis.fetch = previous.fetch;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    delete globalThis[Symbol.for("projector.native-fetch")];
  });
  const auth = await import("../src/common/utilities/lan-auth.ts");
  auth.setLanPassword("test-only-password");
  for (const url of [
    "//attacker.invalid/collect",
    "/\\attacker.invalid/collect",
    "https://attacker.invalid/collect",
  ]) {
    await auth.authedFetch(url);
    assert.equal(calls.at(-1).authorization, null, url);
  }
  await auth.authedFetch("/api/app/network");
  assert.equal(calls.at(-1).authorization, "Bearer test-only-password");
  auth.clearLanPassword();
});

test("Vite resources require LAN authentication; session cookies survive resource loads and expire on password replacement", async (t) => {
  await isolatedLan(t);
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!address) return t.skip("No non-loopback IPv4 interface available");
  const { createServer: createVite } = await import("vite-plus");
  const vite = await createVite({
    configFile: join(process.cwd(), "vite.config.ts"),
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  const server = await listen(t, createServer(vite.middlewares));
  const headers = { Host: "localhost:4177" };
  for (const path of [
    "/package.json",
    `/@fs${process.cwd()}/server/modules/access/access.ts?raw`,
  ]) {
    assert.equal((await send(server, address, path, headers)).status, 401, path);
  }
  const login = await send(server, address, "/projects", { ...headers, Accept: "text/html" });
  assert.equal(login.status, 200);
  assert.match(login.body, /Пароль доступа/);
  const accepted = await send(server, address, "/api/app/network", {
    ...headers,
    Authorization: "Bearer test-only-password",
  });
  assert.equal(accepted.status, 200);
  const setCookie = accepted.headers["set-cookie"][0];
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(setCookie, /test-only-password/);
  const cookie = setCookie.split(";")[0];
  assert.equal(
    (await send(server, address, "/package.json", { ...headers, Cookie: cookie })).status,
    200,
  );
  assert.equal(
    accessAllowed(
      fakeRequest("localhost:4177", address, { cookie, origin: "http://localhost:4177" }),
      true,
    ),
    true,
    "WebSocket cookie",
  );
  assert.equal(
    accessAllowed(
      fakeRequest("localhost:4177", address, { cookie, origin: "http://attacker.invalid" }),
      true,
    ),
    false,
  );
  await updateProjects((projects) =>
    projects.push({
      id: "security-test",
      name: "security-test",
      path: process.cwd(),
      commands: [],
      createdAt: new Date().toISOString(),
      mode: "server",
      url: "",
      icon: "",
      defaultCommandId: "",
    }),
  );
  attachTerminalControlServer(server);
  const client = new WebSocket(
    `ws://${address}:${server.address().port}/api/terminal/control?project=security-test`,
    {
      origin: "http://localhost:4177",
      headers: { Host: "localhost:4177", Cookie: cookie },
    },
  );
  t.after(() => client.terminate());
  const snapshot = once(client, "message");
  await once(client, "open");
  assert.equal(JSON.parse(String((await snapshot)[0])).type, "sessions");
  const closed = once(client, "close");
  setLanPassword("test-only-password");
  await closed;
  assert.equal(
    (await send(server, address, "/package.json", { ...headers, Cookie: cookie })).status,
    401,
  );
});

test("malformed requests cannot crash HTTP or either WebSocket upgrade handler", async (t) => {
  const dir = await isolatedLan(t);
  const server = await listen(
    t,
    createServer((req, res) => {
      if (!authorizeHttp(req, res)) return;
      void handleApi(req, res);
    }),
  );
  attachTerminalServer(server);
  attachTerminalControlServer(server);
  const response = await new Promise((resolve, reject) => {
    const socket = connect(server.address().port, "127.0.0.1", () => {
      socket.write(
        "GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
    });
    let raw = "";
    socket.on("data", (chunk) => {
      raw += chunk;
    });
    socket.on("end", () => resolve(raw));
    socket.on("error", reject);
  });
  assert.match(response, /^HTTP\/1.1 400/);
  assert.equal((await send(server, "127.0.0.1", "/api/app/network", { Host: "[" })).status, 403);
  assert.equal(
    (await send(server, "127.0.0.1", "/api/app/network")).status,
    200,
    "server remains alive",
  );
  const project = join(dir, "svg");
  await mkdir(project);
  await writeFile(
    join(project, "favicon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  const icon = await send(
    server,
    "127.0.0.1",
    `/api/preview-icon?path=${encodeURIComponent(project)}`,
  );
  assert.equal(icon.status, 200);
  assert.equal(icon.headers["content-security-policy"], "default-src 'none'; sandbox");
  assert.equal(icon.headers["x-content-type-options"], "nosniff");
});
