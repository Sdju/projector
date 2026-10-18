import { expect, onTestFinished, test } from "vite-plus/test";
import { readFile, writeFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

test(
  "dozens of tasks stay in a scrolling list with the finished ones folded away",
  { skip: !chromium, timeout: 60000, retry: 2 },
  async () => {
    const html = await readFile(new URL("./fixtures/agent-task-bar.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/bar": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/bar"));
    await browser.viewport(900, 700);
    const settle = () =>
      browser.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
    await settle();
    const rows = (scope) => browser.evaluate(`document.querySelectorAll("${scope} li").length`);
    const summary = () => browser.evaluate('document.querySelector(".bar-summary").textContent');

    // Something runs: the bar is open and shows what runs and what failed, not the 22 done ones.
    expect(await summary()).toContain("Выполняется в фоне: 2");
    expect(await summary()).toContain("ошибок: 1");
    expect(await rows(".task-bar > .scroll > .list")).toBe(3);
    expect(await browser.evaluate('document.querySelector(".finished").open')).toBe(false);

    // Even fully opened, the list is capped and scrolls instead of covering the conversation.
    await browser.click(".finished-summary");
    await settle();
    expect(await rows(".finished")).toBe(22);
    const box = await browser.evaluate(
      '(() => { const s = document.querySelector(".scroll"); return [s.clientHeight, s.scrollHeight]; })()',
    );
    expect(box[0]).toBeLessThanOrEqual(320);
    expect(box[1]).toBeGreaterThan(box[0]);
    const shot = await browser.call("Page.captureScreenshot", { format: "png" });
    if (process.env.TASK_BAR_SHOT) await writeFile(process.env.TASK_BAR_SHOT, shot.data, "base64");

    // Nothing runs any more: the finished ones become the list itself.
    await browser.evaluate("window.fixture.settle()");
    await settle();
    expect(await summary()).toContain("Задачи: 25");
    expect(browser.errors).toEqual([]);
  },
);
