import { expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { handleApi } from "../server/app/api.ts";
import { readNetworkMode, writeNetworkMode } from "../core/modules/app-paths/index.ts";
import {
  accessAllowed,
  isLocalRequest,
  hasLanPassword,
  setLanPassword,
  clearLanPassword,
  verifyLanPassword,
} from "../server/modules/access/index.ts";

function request(headers, remoteAddress = "192.168.1.20", encrypted = false) {
  return { headers, socket: { remoteAddress, encrypted } };
}

test("locality uses the socket address and ignores Host and forwarded headers", () => {
  for (const address of [
    "127.0.0.1",
    "127.2.3.4",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ]) {
    expect(isLocalRequest(request({ host: "remote.example" }, address)), address).toBe(true);
  }
  for (const address of [
    "192.168.1.20",
    "::ffff:192.168.1.20",
    "2001:db8::1",
    "0.0.0.0",
    "localhost",
    "",
    undefined,
  ]) {
    const req = request({
      host: "localhost:4177",
      "x-forwarded-for": "127.0.0.1",
      forwarded: "for=127.0.0.1",
    });
    req.socket.remoteAddress = address;
    expect(isLocalRequest(req), String(address)).toBe(false);
  }
});

test("readNetworkMode honours the one-shot env var over the persisted file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-network-"));
  const previous = process.env.XDG_DATA_HOME;
  const previousNetwork = process.env.PROJECTOR_NETWORK;
  try {
    process.env.XDG_DATA_HOME = dir;
    delete process.env.PROJECTOR_NETWORK;
    expect(readNetworkMode()).toBe("local");
    writeNetworkMode("lan");
    expect(readNetworkMode()).toBe("lan");
    process.env.PROJECTOR_NETWORK = "local";
    expect(readNetworkMode()).toBe("local");
  } finally {
    process.env.XDG_DATA_HOME = previous;
    if (previousNetwork === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previousNetwork;
    await rm(dir, { recursive: true, force: true });
  }
});

test("local mode allows only loopback; lan mode allows network clients", async () => {
  const previous = process.env.PROJECTOR_NETWORK;
  try {
    process.env.PROJECTOR_NETWORK = "local";
    expect(accessAllowed(request({ host: "localhost:4177" }, "127.0.0.1"), false)).toBe(true);
    expect(accessAllowed(request({ host: "127.0.0.1:4177" }, "127.0.0.1"), false)).toBe(true);
    expect(accessAllowed(request({ host: "192.168.1.10:4177" }), false)).toBe(false);
    expect(isLocalRequest(request({ host: "192.168.1.10:4177" }))).toBe(false);
    expect(accessAllowed(request({ host: "localhost:4177" }), false), "spoofed Host").toBe(false);
    expect(
      accessAllowed(request({ host: "evil.example" }, "127.0.0.1"), false),
      "DNS rebinding",
    ).toBe(false);

    process.env.PROJECTOR_NETWORK = "lan";
    expect(accessAllowed(request({ host: "192.168.1.10:4177" }), false)).toBe(true);
    expect(accessAllowed(request({ host: "localhost:4177" }, "127.0.0.1"), false)).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previous;
  }
});

test("origin must match the request host when required", async () => {
  const previous = process.env.PROJECTOR_NETWORK;
  try {
    process.env.PROJECTOR_NETWORK = "lan";
    const host = "192.168.1.10:4177";
    expect(accessAllowed(request({ host, origin: "http://192.168.1.10:4177" }), true)).toBe(true);
    expect(accessAllowed(request({ host, origin: "http://evil.example" }), true)).toBe(false);
    expect(accessAllowed(request({ host }), true), "no origin with requireOrigin").toBe(false);
  } finally {
    if (previous === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previous;
  }
});

test("lan password gates non-loopback clients via bearer token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-network-"));
  const previousData = process.env.XDG_DATA_HOME;
  const previousNetwork = process.env.PROJECTOR_NETWORK;
  try {
    process.env.XDG_DATA_HOME = dir;
    process.env.PROJECTOR_NETWORK = "lan";
    expect(hasLanPassword()).toBe(false);
    setLanPassword("secret");
    expect(hasLanPassword()).toBe(true);
    expect(verifyLanPassword("secret")).toBe(true);
    expect(verifyLanPassword("wrong")).toBe(false);

    const host = "192.168.1.10:4177";
    expect(accessAllowed(request({ host }), false), "no token").toBe(false);
    expect(accessAllowed(request({ host, authorization: "Bearer secret" }), false)).toBe(true);
    expect(accessAllowed(request({ host, authorization: "Bearer wrong" }), false)).toBe(false);
    for (const host of ["localhost:4177", "127.0.0.1:4177", "[::1]:4177"]) {
      const headers = { host, origin: `http://${host}`, "x-forwarded-for": "127.0.0.1" };
      expect(accessAllowed(request(headers), false), "spoofed Host requires password").toBe(false);
      expect(accessAllowed(request(headers), true), "WebSocket also requires password").toBe(false);
      expect(accessAllowed(request(headers), true, "wrong")).toBe(false);
      expect(accessAllowed(request(headers), true, "secret")).toBe(true);
      expect(accessAllowed(request({ ...headers, authorization: "Bearer secret" }), false)).toBe(
        true,
      );
    }
    expect(accessAllowed(request({ host }, "127.0.0.1"), false), "loopback with LAN Host").toBe(
      true,
    );
    expect(
      accessAllowed(request({ host: "localhost:4177" }, "::1"), false),
      "loopback exempt",
    ).toBe(true);

    clearLanPassword();
    expect(hasLanPassword()).toBe(false);
    expect(accessAllowed(request({ host }), false), "open lan after clearing").toBe(true);
  } finally {
    process.env.XDG_DATA_HOME = previousData;
    if (previousNetwork === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previousNetwork;
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP API rejects forged localhost Host over a non-loopback connection", async (t) => {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!address) return t.skip("No non-loopback IPv4 interface available");
  const dir = await mkdtemp(join(tmpdir(), "projector-network-http-"));
  const previousData = process.env.XDG_DATA_HOME;
  const previousNetwork = process.env.PROJECTOR_NETWORK;
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  try {
    process.env.XDG_DATA_HOME = dir;
    process.env.PROJECTOR_NETWORK = "lan";
    setLanPassword("test-password");
    server.listen(0, "0.0.0.0");
    await once(server, "listening");
    const port = server.address().port;
    const send = (hostname, path, token, method = "GET") =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            hostname,
            port,
            path,
            method,
            headers: {
              Host: "localhost:4177",
              Origin: "http://localhost:4177",
              "X-Forwarded-For": "127.0.0.1",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
          (res) => {
            res.resume();
            res.once("end", () => resolve(res.statusCode));
          },
        );
        req.once("error", reject);
        req.end();
      });
    expect(await send(address, "/api/app/network")).toBe(401);
    expect(await send(address, "/api/app/network", "wrong")).toBe(401);
    expect(await send(address, "/api/app/network", "test-password")).toBe(200);
    expect(
      await send(address, "/api/app/network", "test-password", "POST"),
      "local-only action even with valid token",
    ).toBe(403);
    expect(await send("127.0.0.1", "/api/app/network"), "real loopback exempt").toBe(200);
    process.env.PROJECTOR_NETWORK = "local";
    expect(await send(address, "/api/app/network", "test-password")).toBe(403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousNetwork === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previousNetwork;
    await rm(dir, { recursive: true, force: true });
  }
});
