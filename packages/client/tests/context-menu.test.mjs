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

test(
  "context menus and the select picker use the same translucent surface",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async ({ onTestFinished }) => {
    const source = await readFile(
      new URL("../../../tests/fixtures/context-menu.html", import.meta.url),
      "utf8",
    );
    const fixture = await createBrowserFixture({
      pages: {
        "/__popup_theme": source
          .replace("<!doctype html>", '<!doctype html><link rel="icon" href="data:,">')
          .replace(
            '<div id="fixture"></div>',
            '<div id="fixture"></div><select aria-label="Режим"><option value="one">Первый</option><option value="two">Второй</option></select>',
          ),
      },
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.viewport(1200, 900);
    await browser.call("Page.navigate", { url: fixture.url("/__popup_theme?manual") });
    await expect
      .poll(() => browser.evaluate("Boolean(document.querySelector('#host'))"), { timeout: 20000 })
      .toBe(true);
    await browser.evaluate(`(() => {
      const root = document.documentElement;
      root.dataset.themeEffects = '';
      root.style.setProperty('--theme-chrome', 'rgba(19, 40, 62, 0.62)');
      root.style.setProperty('--theme-backdrop', 'blur(18px)');
      document.querySelector('#host').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2,
      }));
    })()`);
    await expect
      .poll(() => browser.evaluate("Boolean(document.querySelector('.context-menu:popover-open'))"))
      .toBe(true);
    const menu = await browser.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('.context-menu'));
      return { background: style.backgroundColor, blur: style.backdropFilter };
    })()`);
    expect(menu).toEqual({ background: "rgba(19, 40, 62, 0.62)", blur: "blur(18px)" });
    await browser.key("Escape");
    await expect
      .poll(
        () => browser.evaluate("Boolean(document.querySelector('.context-menu:popover-open'))"),
        { timeout: 5000 },
      )
      .toBe(false);
    if (
      !(await browser.evaluate(
        "CSS.supports('appearance: base-select') && CSS.supports('selector(::picker(select))')",
      ))
    )
      return;
    await browser.click("select");
    await expect
      .poll(() => browser.evaluate("document.querySelector('select').matches(':open')"))
      .toBe(true);
    expect(
      await browser.evaluate(`(() => {
      const select = document.querySelector('select');
      const style = getComputedStyle(select, '::picker(select)');
      return { background: style.backgroundColor, blur: style.backdropFilter };
    })()`),
    ).toEqual(menu);
    await browser.key("Escape");
    await expect
      .poll(() => browser.evaluate("document.querySelector('select').matches(':open')"))
      .toBe(false);
    await browser.click("select");
    await expect
      .poll(() =>
        browser.evaluate(
          "document.querySelector('option[value=two]').getBoundingClientRect().height > 0",
        ),
      )
      .toBe(true);
    await browser.click("option[value=two]");
    await expect
      .poll(() => browser.evaluate("document.querySelector('select').value"), { timeout: 5000 })
      .toBe("two");
    expect(browser.errors).toEqual([]);
  },
);
