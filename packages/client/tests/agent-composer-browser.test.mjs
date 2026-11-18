import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

test.concurrent(
  "the composer form folds from its own top-right button",
  { skip: !chromium, timeout: 30000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(
      new URL("../../../tests/fixtures/agent-composer.html", import.meta.url),
      "utf8",
    );
    const fixture = await createBrowserFixture({ pages: { "/composer": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/composer"));
    await browser.viewport(620, 600);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    // The form took the place of the text field, and the fold sits in its top-right corner.
    await wait('document.querySelector(".composer-form .form-fold") !== null');
    const box = await browser.evaluate(`(() => {
      const fold = document.querySelector(".composer-form .form-fold").getBoundingClientRect();
      const form = document.querySelector(".composer-form").getBoundingClientRect();
      return {
        rightInset: form.right - fold.right,
        topInset: fold.top - form.top,
        width: fold.width,
        height: fold.height,
      };
    })()`);
    expect(box.rightInset).toBeLessThan(20);
    expect(box.topInset).toBeLessThan(20);
    expect(box.width).toBeLessThan(60);
    expect(box.height).toBeLessThan(60);

    // Folding returns the text field; it must not submit the form.
    await browser.click(".composer-form .form-fold");
    await wait('document.querySelector(".composer-form") === null');
    expect(await browser.evaluate("window.fixture.submitted.length")).toBe(0);
    expect(
      await browser.evaluate('document.querySelector(".composer").classList.contains("form-mode")'),
    ).toBe(false);

    // The icon in the footer brings the same form back with its values.
    await browser.click(".composer-footer .form-toggle");
    await wait('document.querySelector(".composer-form .form-fold") !== null');
    expect(await browser.evaluate('document.querySelector(".composer-form").innerText')).toContain(
      "Заметка",
    );
    expect(await browser.evaluate("window.fixture.submitted.length")).toBe(0);
    expect(browser.errors).toEqual([]);
  },
);
