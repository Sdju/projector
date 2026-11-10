import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

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
      import { applyAppearance, initAppearance, setAppearanceThemes } from "/packages/client/modules/appearance/index.ts";
      try {
        initAppearance();
        window.fixture = {
          ready: true,
          apply: applyAppearance,
          themes: setAppearanceThemes,
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

      await browser.evaluate(`window.fixture.themes([{
        id: 'example/ocean', packageName: 'example', title: 'Ocean', mode: 'light',
        tokens: { bg: '#010203', 'bg-2': '#040506', text: '#fafafa', accent: '#ff0000', hover: '#111111' }
      }]); window.fixture.apply('example/ocean')`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        appearance: "example/ocean",
        theme: "example/ocean",
        scheme: "light",
        background: "rgb(1, 2, 3)",
        colorSchemeMeta: "light",
        themeColorMeta: "#010203",
      });
      expect(
        await browser.evaluate("document.documentElement.style.getPropertyValue('--accent')"),
      ).toBe("#ff0000");

      await browser.evaluate("window.fixture.apply('dark')");
      expect((await browser.evaluate("window.fixture.read()")).background).toBe("rgb(16, 16, 15)");
      expect(
        await browser.evaluate("document.documentElement.style.getPropertyValue('--accent')"),
      ).toBe("");
      expect(
        await browser.evaluate("document.documentElement.style.getPropertyValue('--hover')"),
      ).toBe("");
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const bootstrapHtml = `<!doctype html>
<html data-appearance="example/ocean" data-theme="example/ocean" style="--bg:#010203;--accent:#ff0000">
<head><meta name="color-scheme" content="light"><meta name="theme-color" content="#010203"></head>
<body><pre id="result">WAITING</pre><script type="module">
import { initAppearance, currentAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
const root = document.documentElement;
document.getElementById('result').textContent = currentAppearance() === 'example/ocean' &&
  root.style.getPropertyValue('--bg') === '#010203' &&
  root.style.getPropertyValue('--accent') === '#ff0000' ? 'PASS' : 'FAIL';
</script></body></html>`;

test(
  "appearance init preserves external bootstrap tokens until the catalog arrives",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__appearance_bootstrap": bootstrapHtml },
    });
    const browser = await createChromium(fixture.directory);
    try {
      expect(await browser.result(fixture.url("/__appearance_bootstrap"))).toBe("PASS");
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);
