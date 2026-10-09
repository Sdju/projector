import { expect, onTestFinished, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";

const chromium = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);
test(
  "three island menus open, close with focus restored and emit commands on desktop and mobile",
  { skip: !chromium, timeout: 90000 },
  async () => {
    const html = await readFile(new URL("./fixtures/island-menu.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture("/__island_test", html);
    onTestFinished(() => fixture.close());
    for (const [name, size] of [
      ["desktop", "1200,900"],
      ["mobile", "390,844"],
    ]) {
      const { stdout, stderr } = await promisify(execFile)(
        chromium,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(fixture.directory, name)}`,
          `--window-size=${size}`,
          "--virtual-time-budget=15000",
          "--dump-dom",
          fixture.url,
        ],
        { timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
      );
      const result =
        stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ??
        stdout.slice(-2000) + stderr.slice(-1000);
      expect(result, name).toBe("PASS");
    }
  },
);
