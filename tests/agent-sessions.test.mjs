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
      await act(() => browser.click('[aria-label="История"]'));
      await eventually('document.activeElement.classList.contains("item")', true);
      await act(() => browser.click('[aria-label="Переименовать чат"]'));
      await eventually('document.activeElement.getAttribute("aria-label")', "Название чата");
      await browser.call("Input.insertText", { text: "Changed" });
      await act(() => browser.key("Escape"));
      expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(true);
      expect(await browser.evaluate("window.fixture.changes.length")).toBe(0);
      await act(() => browser.key("Escape"));
      expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(
        false,
      );
      await eventually('document.activeElement.getAttribute("aria-label")', "История");
    }
    await browser.evaluate("window.fixture.empty()");
    await act(() => browser.click('[aria-label="История"]'));
    await browser.evaluate("window.fixture.loaded()");
    await settle();
    await eventually('document.activeElement.classList.contains("item")', true);
    await act(() => browser.key("Escape"));
    await browser.evaluate("window.fixture.many()");
    await act(() => browser.click('[aria-label="История"]'));
    await eventually('document.activeElement.getAttribute("aria-label")', "Найти чат");
    await act(() => browser.click("#outside"));
    expect(await browser.evaluate('Boolean(document.querySelector("[role=dialog]"))')).toBe(false);
    expect(await browser.evaluate("document.activeElement.id")).toBe("outside");
    expect(browser.errors).toEqual([]);
  },
);
test(
  "a chat and its native session are one row, not two",
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
    const settle = () =>
      browser.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
    await browser.evaluate("window.fixture.linked()");
    await settle();
    await browser.click('[aria-label="История"]');
    await settle();
    const titles = await browser.evaluate(
      "[...document.querySelectorAll('.item')].map(item => item.textContent.trim())",
    );
    // The session with a tab is shown once, under the session's title; the two others keep their rows.
    expect(titles.length).toBe(3);
    expect(titles[0]).toContain("Main session");
    expect(titles.some((title) => title.includes("Main tab"))).toBe(false);
    expect(titles.some((title) => title.includes("Tab without a session"))).toBe(true);
    expect(titles.some((title) => title.includes("Other session"))).toBe(true);

    // The merged row opens its tab; a tab-only row does too; a session-only row continues the chat.
    await browser.evaluate("document.querySelectorAll('.item')[0].click()");
    await settle();
    expect(await browser.evaluate("window.fixture.opened")).toEqual([
      { chat: "chat-main", title: "Main session" },
    ]);
    await browser.click('[aria-label="История"]');
    await settle();
    await browser.evaluate(
      "[...document.querySelectorAll('.item')].find(item => item.textContent.includes('Tab without a session')).click()",
    );
    await settle();
    expect(await browser.evaluate("window.fixture.opened[1]")).toEqual({
      chat: "chat-only",
      title: "Tab without a session",
    });
    await browser.click('[aria-label="История"]');
    await settle();
    await browser.evaluate(
      "[...document.querySelectorAll('.item')].find(item => item.textContent.includes('Other session')).click()",
    );
    await settle();
    expect(await browser.evaluate("window.fixture.picks")).toEqual(["session-other"]);
    expect(browser.errors).toEqual([]);
  },
);
test(
  "subagent branches stay folded under their chats and are found by search",
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
    const settle = () =>
      browser.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
    await browser.evaluate("window.fixture.branches()");
    await settle();
    await browser.click('[aria-label="История"]');
    await settle();
    expect(await browser.evaluate("document.querySelectorAll('.item').length")).toBe(3);
    expect(await browser.evaluate("Boolean(document.querySelector('.item.branch'))")).toBe(false);
    expect(
      await browser.evaluate("document.querySelector('.toggle').textContent.trim()"),
    ).toContain("Показать ветки субагентов · 2");
    await browser.click(".toggle");
    await settle();
    expect(await browser.evaluate("document.querySelectorAll('.item').length")).toBe(5);
    expect(await browser.evaluate("document.querySelectorAll('.item.branch').length")).toBe(2);
    expect(await browser.evaluate("document.querySelector('.item.branch').title")).toContain(
      "ветка субагента",
    );
    expect(await browser.evaluate("document.querySelector('.toggle').ariaExpanded")).toBe("true");
    // A branch past the folded list is still reachable through search, which opens the branches.
    await browser.click(".toggle");
    await settle();
    await browser.click("input[type=search]");
    await browser.call("Input.insertText", { text: "Audit" });
    await settle();
    expect(await browser.evaluate("document.querySelectorAll('.item').length")).toBe(1);
    expect(
      await browser.evaluate("document.querySelector('.item').classList.contains('branch')"),
    ).toBe(true);
    expect(await browser.evaluate("document.querySelector('.toggle').disabled")).toBe(true);
    expect(browser.errors).toEqual([]);
  },
);
