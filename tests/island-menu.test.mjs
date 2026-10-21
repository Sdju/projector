import { expect, onTestFinished, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

test(
  "three island menus open, close with focus restored and emit commands on desktop and mobile",
  { skip: !chromium, timeout: 90000, retry: 2 },
  async () => {
    const html = await readFile(new URL("./fixtures/island-menu.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/__island_test": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    for (const [width, height] of [
      [1200, 900],
      [390, 844],
    ]) {
      await browser.viewport(width, height);
      expect(await browser.result(fixture.url("/__island_test")), `${width}px`).toBe("PASS");
    }
  },
);
