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
    // Focus moves and popups close after Vue's next tick; a frame boundary makes them observable.
    const settle = () =>
      browser.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
    const act = async (step) => {
      await step();
      await settle();
    };
    // Focus is moved by Vue after the next tick; poll frames until it lands instead of sampling once.
    const eventually = async (expression, expected) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if ((await browser.evaluate(expression)) === expected) return;
        await settle();
      }
      expect(await browser.evaluate(expression)).toBe(expected);
    };
    for (const width of [1200, 390]) {
      await browser.viewport(width);
      await settle();
      await act(() => browser.click('[aria-label="Прошлые сессии"]'));
      await eventually('document.activeElement.classList.contains("item")', true);
      await act(() => browser.click('[aria-label="Переименовать сессию"]'));
      await eventually('document.activeElement.getAttribute("aria-label")', "Название сессии");
      await browser.call("Input.insertText", { text: "Changed" });
      await act(() => browser.key("Escape"));
      expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(true);
      expect(await browser.evaluate("window.fixture.changes.length")).toBe(0);
      await act(() => browser.key("Escape"));
      expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(
        false,
      );
      await eventually('document.activeElement.getAttribute("aria-label")', "Прошлые сессии");
    }
    await browser.evaluate("window.fixture.empty()");
    await act(() => browser.click('[aria-label="Прошлые сессии"]'));
    await browser.evaluate("window.fixture.loaded()");
    await settle();
    await eventually('document.activeElement.classList.contains("item")', true);
    await act(() => browser.key("Escape"));
    await browser.evaluate("window.fixture.many()");
    await act(() => browser.click('[aria-label="Прошлые сессии"]'));
    await eventually('document.activeElement.getAttribute("aria-label")', "Найти сессию");
    await act(() => browser.click("#outside"));
    expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(false);
    expect(await browser.evaluate("document.activeElement.id")).toBe("outside");
    expect(browser.errors).toEqual([]);
  },
);
