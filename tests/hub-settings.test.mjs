import { afterEach, expect, test } from "vite-plus/test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { configureHub, hubStatus } from "../packages/server/modules/hub/index.ts";
import { dataDir } from "../packages/core/modules/app-paths/index.ts";

afterEach(() => configureHub(null));
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
    token: "test-device-secret",
    deviceId: "renamed",
  });
  if (process.platform !== "win32")
    expect((await stat(join(dataDir(), "hub.json"))).mode & 0o777).toBe(0o600);
  expect(() =>
    configureHub({ url: "https://other.example", deviceId: "renamed", token: "" }),
  ).toThrow();
  expect(hubStatus().url).toBe("http://localhost:4180");
  configureHub(null);
  expect(hubStatus()).toMatchObject({ enabled: false });
  expect(await readFile(join(dataDir(), "hub.json"), "utf8")).toBe("null");
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
