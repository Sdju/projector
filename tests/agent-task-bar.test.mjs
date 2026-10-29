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
    if (process.env.TASK_BAR_SHOT) {
      const shot = await browser.call("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.TASK_BAR_SHOT, shot.data, "base64");
    }

    // Nothing runs any more: the finished ones become the list itself.
    await browser.evaluate("window.fixture.settle()");
    await settle();
    expect(await summary()).toContain("Задачи: 25");
    expect(browser.errors).toEqual([]);
  },
);

test(
  "long commands fit the activity, task list and task view on narrow screens",
  { skip: !chromium },
  async () => {
    const html = await readFile(new URL("./fixtures/agent-task-bar.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/bar": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/bar"));
    await browser.evaluate("window.fixture.longCommands()");
    const settle = () => browser.evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    const geometry = () =>
      browser.evaluate(`(() => {
    const summary = document.querySelector('.activity-summary');
    const page = document.documentElement;
    return { width: summary.clientWidth, height: summary.clientHeight, page: page.clientWidth, scroll: page.scrollWidth };
  })()`);
    for (const width of [900, 360]) {
      await browser.viewport(width, 700);
      await settle();
      let box = await geometry();
      expect(box.scroll).toBeLessThanOrEqual(box.page);
      expect(box.height).toBeLessThan(50);
      await browser.evaluate("window.fixture.finishCommands()");
      await settle();
      box = await geometry();
      expect(box.scroll).toBeLessThanOrEqual(box.page);
      expect(box.height).toBeLessThan(50);
      expect(
        await browser.evaluate('Boolean(document.querySelector(".bar-summary .error-icon"))'),
      ).toBe(true);
      expect(
        await browser.evaluate('Boolean(document.querySelector(".bar-summary .done-icon"))'),
      ).toBe(false);
      if (!(await browser.evaluate('document.querySelector(".task-bar").open'))) {
        await browser.click(".bar-summary");
        await settle();
      }
      await browser.click(".activity-summary");
      await browser.click(".activity-list .tool > summary");
      await settle();
      expect(
        await browser.evaluate(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
      ).toBe(true);
      expect(
        await browser.evaluate('document.querySelector(".activity-list .code").textContent'),
      ).toContain("unbroken_argument_");
      await browser.click(".activity-summary");
      await browser.click(".task-bar .row");
      await settle();
      expect(
        await browser.evaluate('document.querySelector(".task-view .code").textContent'),
      ).toContain("unbroken_argument_");
      expect(
        await browser.evaluate(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
      ).toBe(true);
      await browser.click(".task-view .head button");
      await browser.evaluate("window.fixture.longCommands()");
    }
    expect(browser.errors).toEqual([]);
  },
);
