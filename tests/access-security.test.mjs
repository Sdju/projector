import { expect, onTestFinished, test } from "vite-plus/test";
import { expectPrivate } from "./fixtures/private.mjs";
import { mkdtemp, rm, writeFile, chmod, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { networkInterfaces, tmpdir } from "node:os";
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

async function isolatedLan() {
  const dir = await mkdtemp(join(tmpdir(), "projector-access-security-"));
  const previous = { data: process.env.XDG_DATA_HOME, network: process.env.PROJECTOR_NETWORK };
  process.env.XDG_DATA_HOME = dir;
  process.env.PROJECTOR_NETWORK = "lan";
  onTestFinished(async () => {
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

async function listen(server) {
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return server;
}

test("LAN cannot turn attacker-controlled Host/Origin into local authority", async () => {
  await isolatedLan();
  for (const host of [
    "attacker.invalid:4177",
    "user@localhost:4177",
    "localhost:4177/path",
    "[",
    "",
  ]) {
    const req = fakeRequest(host, "127.0.0.1", { origin: `http://${host}` });
    expect(accessAllowed(req, false), host).toBe(false);
  }
  expect(
    accessAllowed(
      fakeRequest("127.0.0.1:4177", "127.0.0.1", { origin: "https://attacker.invalid" }),
      false,
    ),
  ).toBe(false);
});

test("corrupt credentials fail closed, and replacing a password restores file permissions", async () => {
  await isolatedLan();
  const req = fakeRequest("192.0.2.1:4177", "192.0.2.10", { authorization: "Bearer arbitrary" });
  for (const data of ["", "corrupt", "ab:zz", "a".repeat(32) + ":" + "a".repeat(2)]) {
    await writeFile(lanPasswordPath(), data);
    expect(hasLanPassword).toThrow(/Повреждён/);
    expect(accessAllowed(req, false)).toBe(false);
    expect(accessAllowed(fakeRequest(), false)).toBe(false);
  }
  await rm(lanPasswordPath());
  await mkdir(lanPasswordPath());
  expect(accessAllowed(fakeRequest(), false), "unreadable credential path").toBe(false);
  await rm(lanPasswordPath(), { recursive: true });
  setLanPassword("test-only-password");
  await chmod(lanPasswordPath(), 0o644);
  setLanPassword("replacement");
  await expectPrivate(lanPasswordPath());
});

test("fetch isolates LAN credentials and prompts only on an explicit LAN challenge", async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = [];
  const responses = [];
  let prompts = 0;
  globalThis.window = {
    location: { origin: "http://localhost:4177" },
    prompt: () => {
      prompts++;
      return "new-test-password";
    },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
    return responses.shift() ?? new Response("{}");
  };
  onTestFinished(() => {
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
    expect(calls.at(-1).authorization, url).toBe(null);
  }
  await auth.authedFetch("/api/app/network");
  expect(calls.at(-1).authorization).toBe("Bearer test-only-password");
  auth.clearLanPassword();
  for (const challenge of [null, 'Bearer realm="GitHub"']) {
    responses.push(
      new Response('{"error":"GitHub authorization expired"}', {
        status: 401,
        headers: challenge ? { "WWW-Authenticate": challenge } : {},
      }),
    );
    const before = calls.length;
    const response = await auth.authedFetch(
      "/api/integrations/github/browse/repository?repository=vuejs/core",
    );
    expect(response.status).toBe(401);
    expect(prompts, "upstream authentication is not a LAN password challenge").toBe(0);
    expect(calls.length, "no password retry against GitHub").toBe(before + 1);
  }
  responses.push(
    new Response("{}", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="Projector LAN"' },
    }),
  );
  expect((await auth.authedFetch("/api/app/network")).status).toBe(200);
  expect(prompts).toBe(1);
  expect(calls.at(-1).authorization).toBe("Bearer new-test-password");
  auth.clearLanPassword();
});

test("Vite resources require LAN authentication; session cookies survive resource loads and expire on password replacement", async (t) => {
  const dir = await isolatedLan();
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!address) return t.skip("No non-loopback IPv4 interface available");
  const { createServer: createVite } = await import("vite-plus");
  const vite = await createVite({
    configFile: join(process.cwd(), "vite.config.ts"),
    cacheDir: join(dir, "vite-cache"),
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  onTestFinished(() => vite.close());
  const server = await listen(createServer(vite.middlewares));
  const headers = { Host: "localhost:4177" };
  const unauthorized = await send(server, address, "/api/app/network", headers);
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers["www-authenticate"]).toBe('Bearer realm="Projector LAN"');
  for (const path of [
    "/package.json",
    `/@fs${process.cwd()}/server/modules/access/access.ts?raw`,
  ]) {
    expect((await send(server, address, path, headers)).status, path).toBe(401);
  }
  const login = await send(server, address, "/projects", { ...headers, Accept: "text/html" });
  expect(login.status).toBe(200);
  expect(login.body).toMatch(/Пароль доступа/);
  const accepted = await send(server, address, "/api/app/network", {
    ...headers,
    Authorization: "Bearer test-only-password",
  });
  expect(accepted.status).toBe(200);
  const setCookie = accepted.headers["set-cookie"][0];
  expect(setCookie).toMatch(/HttpOnly; SameSite=Strict/);
  expect(setCookie).not.toMatch(/test-only-password/);
  const cookie = setCookie.split(";")[0];
  expect(
    (await send(server, address, "/package.json", { ...headers, Cookie: cookie })).status,
  ).toBe(200);
  expect(
    accessAllowed(
      fakeRequest("localhost:4177", address, { cookie, origin: "http://localhost:4177" }),
      true,
    ),
    "WebSocket cookie",
  ).toBe(true);
  expect(
    accessAllowed(
      fakeRequest("localhost:4177", address, { cookie, origin: "http://attacker.invalid" }),
      true,
    ),
  ).toBe(false);
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
  onTestFinished(() => client.terminate());
  const snapshot = once(client, "message");
  await once(client, "open");
  expect(JSON.parse(String((await snapshot)[0])).type).toBe("sessions");
  const closed = once(client, "close");
  setLanPassword("test-only-password");
  await closed;
  expect(
    (await send(server, address, "/package.json", { ...headers, Cookie: cookie })).status,
  ).toBe(401);
});

test("malformed requests cannot crash HTTP or either WebSocket upgrade handler", async () => {
  const dir = await isolatedLan();
  const server = await listen(
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
  expect(response).toMatch(/^HTTP\/1.1 400/);
  expect((await send(server, "127.0.0.1", "/api/app/network", { Host: "[" })).status).toBe(403);
  expect((await send(server, "127.0.0.1", "/api/app/network")).status, "server remains alive").toBe(
    200,
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
  expect(icon.status).toBe(200);
  expect(icon.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect(icon.headers["x-content-type-options"]).toBe("nosniff");
});
