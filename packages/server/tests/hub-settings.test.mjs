import { afterEach, expect, test, vi } from "vite-plus/test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bindHub, configureHub, hubStatus } from "../modules/hub/index.ts";
import { dataDir } from "../../core/modules/app-paths/index.ts";

const lifecycle = vi.hoisted(() => ({ events: [] }));
vi.mock("../modules/hub/connector.ts", () => ({
  connectHub: (config) => {
    lifecycle.events.push(`start:${config.url}`);
    return () => lifecycle.events.push(`stop:${config.url}`);
  },
}));
afterEach(() => {
  configureHub(null);
  lifecycle.events.length = 0;
});
test("local settings retain a hidden credential only for the same Hub and remove it on disconnect", async () => {
  configureHub({ url: "http://localhost:4180", deviceId: "desk", token: "test-device-secret" });
  expect(hubStatus()).toMatchObject({
    enabled: true,
    url: "http://localhost:4180",
    deviceId: "desk",
  });
  expect(JSON.stringify(hubStatus())).not.toContain("test-device-secret");
  configureHub({ url: "http://localhost:4180/", deviceId: "renamed", token: "" });
  expect(JSON.parse(await readFile(join(dataDir(), "hub.json"), "utf8"))).toMatchObject({
    connections: [
      { url: "http://localhost:4180", token: "test-device-secret", deviceId: "renamed" },
    ],
    activeUrl: "http://localhost:4180",
  });
  if (process.platform !== "win32")
    expect((await stat(join(dataDir(), "hub.json"))).mode & 0o777).toBe(0o600);
  expect(() =>
    configureHub({ url: "https://other.example", deviceId: "renamed", token: "" }),
  ).toThrow();
  expect(hubStatus().url).toBe("http://localhost:4180");
  configureHub(null);
  expect(hubStatus()).toMatchObject({ enabled: false });
  expect(JSON.parse(await readFile(join(dataDir(), "hub.json"), "utf8"))).toEqual({
    connections: [],
    activeUrl: null,
  });
});
test.each([
  "http://remote.example",
  "https://user:pass@example.com",
  "https://example.com/path",
  "https://example.com/?token=secret",
])("rejects an unsafe Hub address: %s", (url) => {
  expect(() => configureHub({ url, deviceId: "desk", token: "secret" })).toThrow();
  expect(hubStatus().enabled).toBe(false);
});

test("saved Hubs keep separate secrets and switch a single connector, including after reload", () => {
  const first = { url: "https://first.example", deviceId: "desk", token: "first-secret" };
  const second = { url: "https://second.example", deviceId: "laptop", token: "second-secret" };
  configureHub(first);
  const stop = bindHub({});
  try {
    configureHub({ ...second, action: "save" });
    configureHub({ ...first, token: "", deviceId: "renamed", action: "save" });
    expect(hubStatus()).toMatchObject({
      url: first.url,
      connections: [secondWithoutToken(second), { url: first.url, deviceId: "renamed" }],
    });
    expect(JSON.stringify(hubStatus())).not.toContain("secret");
    configureHub({ action: "activate", url: second.url });
    configureHub({ enabled: false });
    expect(hubStatus()).toMatchObject({
      enabled: false,
      connections: expect.arrayContaining([secondWithoutToken(second)]),
    });
    configureHub({ action: "activate", url: first.url });
    expect(hubStatus().deviceId).toBe("renamed");
    configureHub({ action: "delete", url: second.url });
    expect(hubStatus().url).toBe(first.url);
    expect(lifecycle.events).toEqual([
      `start:${first.url}`,
      `stop:${first.url}`,
      `start:${first.url}`,
      `stop:${first.url}`,
      `start:${second.url}`,
      `stop:${second.url}`,
      `start:${first.url}`,
    ]);
  } finally {
    stop();
  }
  const stopReloaded = bindHub({});
  try {
    expect(hubStatus()).toMatchObject({
      url: first.url,
      connections: [{ url: first.url, deviceId: "renamed" }],
    });
    configureHub({ action: "delete", url: first.url });
    expect(hubStatus()).toMatchObject({ enabled: false, connections: [] });
    expect(() => configureHub({ action: "activate", url: second.url })).toThrow("Hub не найден");
  } finally {
    stopReloaded();
  }
});
function secondWithoutToken({ url, deviceId }) {
  return { url, deviceId };
}

test("loads legacy single-Hub settings and persists the migrated list on save", async () => {
  configureHub(null);
  await writeFile(
    join(dataDir(), "hub.json"),
    JSON.stringify({ url: "https://old.example", deviceId: "desk", token: "old-secret" }),
  );
  const stop = bindHub({});
  try {
    expect(hubStatus()).toMatchObject({
      url: "https://old.example",
      connections: [{ url: "https://old.example", deviceId: "desk" }],
    });
    configureHub({ action: "save", url: "https://old.example", deviceId: "desk", token: "" });
    const stored = JSON.parse(await readFile(join(dataDir(), "hub.json"), "utf8"));
    expect(stored.connections[0].token).toBe("old-secret");
    configureHub({ enabled: false });
  } finally {
    stop();
  }
  const stopReloaded = bindHub({});
  try {
    expect(hubStatus()).toMatchObject({
      enabled: false,
      connections: [{ url: "https://old.example", deviceId: "desk" }],
    });
  } finally {
    stopReloaded();
  }
});
