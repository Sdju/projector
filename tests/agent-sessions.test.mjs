import { expect, onTestFinished, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

test(
  "sessions focus the first item, cancel rename before closing, and restore the trigger",
  {
    skip: !chromium,
    timeout: 60000,
  },
  async () => {
    const html = await readFile(new URL("./fixtures/agent-sessions.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/sessions": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/sessions"));
    for (const width of [1200, 390]) {
      await browser.viewport(width);
      await browser.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      await browser.click('[aria-label="Прошлые сессии"]');
      expect(await browser.evaluate('document.activeElement.classList.contains("item")')).toBe(
        true,
      );
      await browser.click('[aria-label="Переименовать сессию"]');
      expect(await browser.evaluate('document.activeElement.getAttribute("aria-label")')).toBe(
        "Название сессии",
      );
      await browser.call("Input.insertText", { text: "Changed" });
      await browser.key("Escape");
      expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(true);
      expect(await browser.evaluate("window.fixture.changes.length")).toBe(0);
      await browser.key("Escape");
      expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(
        false,
      );
      expect(await browser.evaluate('document.activeElement.getAttribute("aria-label")')).toBe(
        "Прошлые сессии",
      );
    }
    await browser.evaluate("window.fixture.empty()");
    await browser.click('[aria-label="Прошлые сессии"]');
    await browser.evaluate("window.fixture.loaded()");
    expect(await browser.evaluate('document.activeElement.classList.contains("item")')).toBe(true);
    await browser.key("Escape");
    await browser.evaluate("window.fixture.many()");
    await browser.click('[aria-label="Прошлые сессии"]');
    expect(await browser.evaluate('document.activeElement.getAttribute("aria-label")')).toBe(
      "Найти сессию",
    );
    await browser.click("#outside");
    expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(false);
    expect(await browser.evaluate("document.activeElement.id")).toBe("outside");
    expect(browser.errors).toEqual([]);
  },
);
