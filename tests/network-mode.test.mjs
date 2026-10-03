import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NETWORK_MODES,
  isNetworkMode,
  networkHost,
} from "../core/modules/network-mode/index.ts";
import {
  readNetworkMode,
  writeNetworkMode,
} from "../core/modules/app-paths/index.ts";
import {
  accessAllowed,
  isLocalRequest,
  hasLanPassword,
  setLanPassword,
  clearLanPassword,
  verifyLanPassword,
} from "../server/modules/access/index.ts";

function request(headers, encrypted = false) {
  return { headers, socket: { encrypted } };
}

test("network modes map to host binding", () => {
  assert.deepEqual(NETWORK_MODES, ["local", "lan"]);
  assert.equal(networkHost("local"), "localhost");
  assert.equal(networkHost("lan"), "0.0.0.0");
  assert.equal(isNetworkMode("lan"), true);
  assert.equal(isNetworkMode("localhost"), false);
  assert.equal(isNetworkMode(undefined), false);
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
    assert.equal(accessAllowed(request({ host: "localhost:4177" }), false), true);
    assert.equal(accessAllowed(request({ host: "127.0.0.1:4177" }), false), true);
    assert.equal(accessAllowed(request({ host: "192.168.1.10:4177" }), false), false);
    assert.equal(isLocalRequest(request({ host: "192.168.1.10:4177" })), false);

    process.env.PROJECTOR_NETWORK = "lan";
    assert.equal(accessAllowed(request({ host: "192.168.1.10:4177" }), false), true);
    assert.equal(accessAllowed(request({ host: "localhost:4177" }), false), true);
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
    assert.equal(
      accessAllowed(request({ host, origin: "http://192.168.1.10:4177" }), true),
      true,
    );
    assert.equal(
      accessAllowed(request({ host, origin: "http://evil.example" }), true),
      false,
    );
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
    assert.equal(
      accessAllowed(request({ host, authorization: "Bearer secret" }), false),
      true,
    );
    assert.equal(
      accessAllowed(request({ host, authorization: "Bearer wrong" }), false),
      false,
    );
    assert.equal(accessAllowed(request({ host: "localhost:4177" }), false), true, "loopback exempt");

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
