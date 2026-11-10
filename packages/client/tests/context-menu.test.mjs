import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

test.concurrent(
  "context menu stays a pointer popover on desktop and becomes an island sheet on a phone",
  { skip: !chromium, timeout: 90000, retry: 2 },
  async ({ onTestFinished }) => {
    const html = await readFile(
      new URL("../../../tests/fixtures/context-menu.html", import.meta.url),
      "utf8",
    );
    const fixture = await createBrowserFixture({ pages: { "/__context_menu_test": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    for (const [width, height] of [
      [1200, 900],
      [390, 844],
    ]) {
      await browser.viewport(width, height);
      expect(await browser.result(fixture.url("/__context_menu_test")), `${width}px`).toBe("PASS");
    }
  },
);
