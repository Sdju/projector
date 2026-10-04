import assert from "node:assert/strict";
import { test } from "node:test";
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
    assert.equal(isLocalRequest(request({ host: "remote.example" }, address)), true, address);
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
    assert.equal(isLocalRequest(req), false, String(address));
  }
});

test("readNetworkMode honours the one-shot env var over the persisted file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-network-"));
  const previous = process.env.XDG_DATA_HOME;
  const previousNetwork = process.env.PROJECTOR_NETWORK;
  try {
    process.env.XDG_DATA_HOME = dir;
    delete process.env.PROJECTOR_NETWORK;
    assert.equal(readNetworkMode(), "local");
    writeNetworkMode("lan");
    assert.equal(readNetworkMode(), "lan");
    process.env.PROJECTOR_NETWORK = "local";
    assert.equal(readNetworkMode(), "local");
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
    assert.equal(accessAllowed(request({ host: "localhost:4177" }, "127.0.0.1"), false), true);
    assert.equal(accessAllowed(request({ host: "127.0.0.1:4177" }, "127.0.0.1"), false), true);
    assert.equal(accessAllowed(request({ host: "192.168.1.10:4177" }), false), false);
    assert.equal(isLocalRequest(request({ host: "192.168.1.10:4177" })), false);
    assert.equal(accessAllowed(request({ host: "localhost:4177" }), false), false, "spoofed Host");
    assert.equal(
      accessAllowed(request({ host: "evil.example" }, "127.0.0.1"), false),
      false,
      "DNS rebinding",
    );

    process.env.PROJECTOR_NETWORK = "lan";
    assert.equal(accessAllowed(request({ host: "192.168.1.10:4177" }), false), true);
    assert.equal(accessAllowed(request({ host: "localhost:4177" }, "127.0.0.1"), false), true);
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
    assert.equal(accessAllowed(request({ host, origin: "http://192.168.1.10:4177" }), true), true);
    assert.equal(accessAllowed(request({ host, origin: "http://evil.example" }), true), false);
    assert.equal(accessAllowed(request({ host }), true), false, "no origin with requireOrigin");
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
    assert.equal(hasLanPassword(), false);
    setLanPassword("secret");
    assert.equal(hasLanPassword(), true);
    assert.equal(verifyLanPassword("secret"), true);
    assert.equal(verifyLanPassword("wrong"), false);

    const host = "192.168.1.10:4177";
    assert.equal(accessAllowed(request({ host }), false), false, "no token");
    assert.equal(accessAllowed(request({ host, authorization: "Bearer secret" }), false), true);
    assert.equal(accessAllowed(request({ host, authorization: "Bearer wrong" }), false), false);
    for (const host of ["localhost:4177", "127.0.0.1:4177", "[::1]:4177"]) {
      const headers = { host, origin: `http://${host}`, "x-forwarded-for": "127.0.0.1" };
      assert.equal(accessAllowed(request(headers), false), false, "spoofed Host requires password");
      assert.equal(
        accessAllowed(request(headers), true),
        false,
        "WebSocket also requires password",
      );
      assert.equal(accessAllowed(request(headers), true, "wrong"), false);
      assert.equal(accessAllowed(request(headers), true, "secret"), true);
      assert.equal(
        accessAllowed(request({ ...headers, authorization: "Bearer secret" }), false),
        true,
      );
    }
    assert.equal(
      accessAllowed(request({ host }, "127.0.0.1"), false),
      true,
      "loopback with LAN Host",
    );
    assert.equal(
      accessAllowed(request({ host: "localhost:4177" }, "::1"), false),
      true,
      "loopback exempt",
    );

    clearLanPassword();
    assert.equal(hasLanPassword(), false);
    assert.equal(accessAllowed(request({ host }), false), true, "open lan after clearing");
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
    assert.equal(await send(address, "/api/app/network"), 401);
    assert.equal(await send(address, "/api/app/network", "wrong"), 401);
    assert.equal(await send(address, "/api/app/network", "test-password"), 200);
    assert.equal(
      await send(address, "/api/app/network", "test-password", "POST"),
      403,
      "local-only action even with valid token",
    );
    assert.equal(await send("127.0.0.1", "/api/app/network"), 200, "real loopback exempt");
    process.env.PROJECTOR_NETWORK = "local";
    assert.equal(await send(address, "/api/app/network", "test-password"), 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousNetwork === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previousNetwork;
    await rm(dir, { recursive: true, force: true });
  }
});
