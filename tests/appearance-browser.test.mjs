import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<html lang="ru" data-appearance="dark">
  <head>
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#171716" />
  </head>
  <body>
    <div id="box" style="background: var(--bg); color: var(--text)">Схема</div>
    <pre id="result">WAITING</pre>
    <script type="module">
      import "/packages/client/app/styles.css";
      import { applyAppearance, initAppearance } from "/packages/client/modules/appearance/index.ts";
      try {
        initAppearance();
        window.fixture = {
          ready: true,
          apply: applyAppearance,
          read: () => ({
            appearance: document.documentElement.dataset.appearance,
            theme: document.documentElement.dataset.theme,
            scheme: getComputedStyle(document.documentElement).colorScheme,
            background: getComputedStyle(document.getElementById("box")).backgroundColor,
            colorSchemeMeta: document.querySelector('meta[name="color-scheme"]').content,
            themeColorMeta: document.querySelector('meta[name="theme-color"]').content,
          }),
        };
        document.getElementById("result").textContent = "PASS";
      } catch (error) {
        document.getElementById("result").textContent = "FAIL: " + error.stack;
      }
    </script>
  </body>
</html>`;

test(
  "appearance switches tokens, meta tags and the system scheme without reload",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__appearance": html } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance"));
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        appearance: "dark",
        theme: "dark",
        scheme: "dark",
        background: "rgb(16, 16, 15)",
        colorSchemeMeta: "dark",
        themeColorMeta: "#171716",
      });

      await browser.evaluate("window.fixture.apply('light')");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        appearance: "light",
        theme: "light",
        scheme: "light",
        background: "rgb(247, 246, 241)",
        colorSchemeMeta: "light",
        themeColorMeta: "#efeee8",
      });

      await browser.evaluate("window.fixture.apply('contrast')");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        appearance: "contrast",
        theme: "contrast",
        scheme: "dark",
        background: "rgb(0, 0, 0)",
        colorSchemeMeta: "dark",
        themeColorMeta: "#080808",
      });

      await browser.call("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }],
      });
      await browser.evaluate("window.fixture.apply('auto')");
      expect((await browser.evaluate("window.fixture.read()")).theme).toBe("light");

      await browser.call("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      });
      expect(
        await browser.evaluate(
          "new Promise(resolve => setTimeout(() => resolve(window.fixture.read().theme), 100))",
        ),
      ).toBe("dark");
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);
