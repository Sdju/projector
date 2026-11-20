import { expect, test } from "vite-plus/test";
import { pluginAssetPath, pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const html = `<!doctype html>
<html lang="ru" data-appearance="dark">
  <head>
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#171716" />
    <link id="app-favicon" rel="icon" href="/favicon.svg" />
    <link id="app-manifest" rel="manifest" href="/manifest.webmanifest" />
    <link id="app-touch-icon" rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta id="app-status-bar" name="apple-mobile-web-app-status-bar-style" content="black" />
  </head>
  <body>
    <div id="box" style="background: var(--bg); color: var(--text)">Схема</div>
    <pre id="result">WAITING</pre>
    <script type="module">
      import "/packages/client/app/styles.css";
      import { applyAppearance, appearanceScheme, initAppearance, setAppearanceThemes } from "/packages/client/modules/appearance/index.ts";
      try {
        initAppearance();
        window.fixture = {
          ready: true,
          apply: applyAppearance,
          themes: setAppearanceThemes,
          painted: () => appearanceScheme.value,
          brand: () => ({
            favicon: document.getElementById('app-favicon').getAttribute('href'),
            manifest: document.getElementById('app-manifest').getAttribute('href'),
            touch: document.getElementById('app-touch-icon').getAttribute('href'),
            status: document.getElementById('app-status-bar').getAttribute('content'),
          }),
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
      expect(await browser.evaluate("window.fixture.painted()")).toBe("dark");
      expect(await browser.evaluate("window.fixture.brand()")).toStrictEqual({
        favicon: "/favicon.svg",
        manifest: "/manifest.webmanifest",
        touch: "/icons/apple-touch-icon.png",
        status: "black",
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
      expect(await browser.evaluate("window.fixture.painted()")).toBe("light");
      expect(await browser.evaluate("window.fixture.brand()")).toStrictEqual({
        favicon: "/favicon-light.svg",
        manifest: "/manifest-light.webmanifest",
        touch: "/icons/apple-touch-icon-light.png",
        status: "default",
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
      expect(await browser.evaluate("window.fixture.painted()")).toBe("contrast");
      expect((await browser.evaluate("window.fixture.brand()")).manifest).toBe(
        "/manifest.webmanifest",
      );

      await browser.call("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }],
      });
      await browser.evaluate("window.fixture.apply('auto')");
      expect((await browser.evaluate("window.fixture.read()")).theme).toBe("light");
      expect(await browser.evaluate("window.fixture.painted()")).toBe("light");

      await browser.call("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      });
      expect(
        await browser.evaluate(
          "new Promise(resolve => setTimeout(() => resolve(window.fixture.read().theme), 100))",
        ),
      ).toBe("dark");
      expect(await browser.evaluate("window.fixture.painted()")).toBe("dark");

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
      expect(await browser.evaluate("window.fixture.painted()")).toBe("example/ocean");
      expect((await browser.evaluate("window.fixture.brand()")).manifest).toBe(
        "/manifest-light.webmanifest",
      );

      await browser.evaluate("window.fixture.apply('dark')");
      expect((await browser.evaluate("window.fixture.read()")).background).toBe("rgb(16, 16, 15)");
      expect(
        await browser.evaluate("document.documentElement.style.getPropertyValue('--accent')"),
      ).toBe("");
      expect(
        await browser.evaluate("document.documentElement.style.getPropertyValue('--hover')"),
      ).toBe("");
      expect(await browser.evaluate("window.fixture.painted()")).toBe("dark");
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const contrastHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
const names = ['bg', 'bg-2', 'bg-3', 'bg-4', 'text', 'text-2', 'muted', 'faint', 'accent', 'run', 'err', 'warn', 'info'];
window.fixture = {
  ready: true,
  apply: applyAppearance,
  tokens: () => {
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((name) => [name, styles.getPropertyValue('--' + name).trim()]));
  },
};
</script>
</body></html>`;

test(
  "built-in schemes keep text readable on every surface",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__appearance_contrast": contrastHtml },
    });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_contrast"));
      for (const scheme of ["dark", "light", "contrast", "frozen-glass"]) {
        await browser.evaluate(`window.fixture.apply(${JSON.stringify(scheme)})`);
        const tokens = await browser.evaluate("window.fixture.tokens()");
        for (const surface of ["bg", "bg-2", "bg-3", "bg-4"])
          for (const ink of [
            "text",
            "text-2",
            "muted",
            "faint",
            "accent",
            "run",
            "err",
            "warn",
            "info",
          ])
            expect(
              contrastRatio(tokens[ink], tokens[surface]),
              `${scheme}: ${ink} on ${surface}`,
            ).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const editorHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0">
<div id="editor" style="height:320px"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h } from 'vue';
import CodeViewer from '/packages/client/modules/workspace/modules/viewers/ui/CodeViewer.vue';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
import { applyEditorTheme } from '/packages/client/modules/workspace/modules/viewers/lib/editor-theme.ts';
initAppearance();
createApp({
  render: () => h(CodeViewer, { path: 'probe.ts', content: 'const alive = true;', editable: false }),
}).mount('#editor');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  theme: applyEditorTheme,
  read: () => {
    const editor = document.querySelector('.cm-editor');
    if (!editor) return null;
    return {
      bg: getComputedStyle(editor).backgroundColor,
      color: getComputedStyle(editor).color,
      syntax: [...document.querySelectorAll('.cm-line span')]
        .map((node) => getComputedStyle(node).color)
        .filter((color) => color !== 'rgb(236, 236, 230)'),
      classic: editor.classList.contains('editor-classic'),
    };
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "CodeMirror repaints surfaces and syntax when the scheme changes",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__appearance_editor": editorHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_editor"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.cm-line span') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");

      const dark = await browser.evaluate("window.fixture.read()");
      expect(dark.bg).toBe("rgb(16, 16, 15)");
      expect(dark.color).toBe("rgb(236, 236, 230)");
      expect(dark.syntax).toContain("rgb(184, 171, 119)");

      await browser.evaluate("window.fixture.apply('light')");
      const light = await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        const read = window.fixture.read();
        resolve(read);
      }))`);
      expect(light.bg).toBe("rgb(247, 246, 241)");
      expect(light.color).toBe("rgb(29, 29, 26)");
      expect(light.syntax).toContain("rgb(109, 91, 35)");

      await browser.evaluate("window.fixture.apply('contrast')");
      const contrast =
        await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        resolve(window.fixture.read());
      }))`);
      expect(contrast.bg).toBe("rgb(0, 0, 0)");
      expect(contrast.color).toBe("rgb(255, 255, 255)");
      expect(contrast.syntax).toContain("rgb(255, 212, 92)");

      await browser.evaluate("window.fixture.apply('dark')");
      await browser.evaluate("window.fixture.theme('projector')");
      const classic = await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        resolve(window.fixture.read());
      }))`);
      expect(classic.classic).toBe(true);
      expect(classic.syntax).toContain("rgb(127, 176, 214)");

      await browser.evaluate("window.fixture.theme('projector-soft')");
      const soft = await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        resolve(window.fixture.read());
      }))`);
      expect(soft.classic).toBe(false);
      expect(soft.syntax).toContain("rgb(184, 171, 119)");
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const markdownHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0">
<div id="markdown" style="height:480px"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h } from 'vue';
import VisualMarkdownEditor from '/packages/client/modules/workspace/modules/viewers/ui/VisualMarkdownEditor.vue';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
createApp({
  render: () => h(VisualMarkdownEditor, {
    content: '\\u0060\\u0060\\u0060js\\nconst alive = true;\\n\\u0060\\u0060\\u0060\\n',
    path: 'probe.md',
    projectId: 'test',
    editable: true,
  }),
}).mount('#markdown');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  read: () => {
    const editor = document.querySelector('.milkdown-code-block .cm-editor');
    const block = document.querySelector('.milkdown-code-block');
    if (!editor || !block) return null;
    return {
      bg: getComputedStyle(block).backgroundColor,
      color: getComputedStyle(editor).color,
      syntax: [...editor.querySelectorAll('.cm-line span')]
        .map((node) => getComputedStyle(node).color)
        .filter((color) => color !== 'rgb(236, 236, 230)'),
    };
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "Markdown code blocks follow the painted scheme",
  { skip: !chromium, timeout: 60000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__appearance_markdown": markdownHtml },
    });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_markdown"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.milkdown-code-block .cm-line span') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");

      const dark = await browser.evaluate("window.fixture.read()");
      expect(dark.bg).toBe("rgb(12, 12, 11)");
      expect(dark.syntax).toContain("rgb(184, 171, 119)");

      await browser.evaluate("window.fixture.apply('light')");
      const light = await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        resolve(window.fixture.read());
      }))`);
      expect(light.bg).toBe("rgb(251, 250, 247)");
      expect(light.syntax).toContain("rgb(109, 91, 35)");

      await browser.evaluate("window.fixture.apply('contrast')");
      const contrast =
        await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        resolve(window.fixture.read());
      }))`);
      expect(contrast.bg).toBe("rgb(0, 0, 0)");
      expect(contrast.syntax).toContain("rgb(255, 212, 92)");
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const fileIconsHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0">
<div id="icon"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h } from 'vue';
import { FileIcon } from '/packages/client/modules/file-icons/index.ts';
import { reloadFileIconTheme } from '/packages/client/modules/file-icons/theme.ts';
import { applyAppearance, initAppearance, setAppearanceThemes } from '/packages/client/modules/appearance/index.ts';
initAppearance();
createApp({
  render: () => h(FileIcon, {
    icon: { id: 'file', src: '/file-icons/icons/file.svg', color: '#89b4fa', colorName: 'blue' },
  }),
}).mount('#icon');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  themes: setAppearanceThemes,
  read: () => {
    const icon = document.querySelector('.file-icon');
    return icon ? { color: getComputedStyle(icon).color } : null;
  },
};
window.marker = Math.random();
reloadFileIconTheme().then(() => { window.fixture.themeReady = true; });
</script>
</body></html>`;

test(
  "file icon palette follows the painted scheme",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__appearance_icons": fileIconsHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_icons"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => window.fixture.themeReady && document.querySelector('.file-icon') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(137, 180, 250)",
      });

      await browser.evaluate("window.fixture.apply('light')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(30, 95, 194)",
      });

      await browser.evaluate("window.fixture.apply('contrast')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(137, 180, 250)",
      });

      await browser.evaluate(`window.fixture.themes([{
        id: 'example/ocean', packageName: 'example', title: 'Ocean', mode: 'light',
        tokens: { bg: '#010203' }
      }]); window.fixture.apply('example/ocean')`);
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(30, 95, 194)",
      });

      await browser.evaluate("window.fixture.apply('dark')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(137, 180, 250)",
      });
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const chatHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0;background:var(--bg)">
<div id="chat"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h } from 'vue';
import AgentTurn from '/packages/client/modules/agent-turns/ui/AgentTurn.vue';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
createApp({
  render: () => h(AgentTurn, {
    turn: { id: 'turn', role: 'assistant', text: 'Ответ агента', tools: [] },
  }),
}).mount('#chat');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  read: () => {
    const body = document.querySelector('.assistant-body');
    return body ? { color: getComputedStyle(body).color } : null;
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "agent chat follows the painted scheme without reload",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__appearance_chat": chatHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_chat"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.assistant-body') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(236, 236, 230)",
      });

      await browser.evaluate("window.fixture.apply('light')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(29, 29, 26)",
      });
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const settingsHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body>
<div id="settings"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h, ref } from 'vue';
import InterfaceSettings from '/packages/client/modules/launcher/InterfaceSettings.vue';
import SettingsWorkbench from '/packages/client/modules/settings/SettingsWorkbench.vue';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
import { createCommandService } from '/packages/core/modules/ide/index.ts';
import { commandHostKey } from '/packages/client/common/utilities/commands.ts';
initAppearance();
const originalFetch = window.fetch;
const appearance = {
  choice: 'dark',
  fonts: { chat: 13, editor: 13, terminal: 13 },
  themeSettings: {},
  themes: [],
};
window.fetch = async (input, options) => {
  if (input === '/api/appearance') {
    if (options?.method === 'PUT') {
      const patch = JSON.parse(options.body);
      if (patch.choice) appearance.choice = patch.choice;
      for (const [id, values] of Object.entries(patch.themeSettings ?? {}))
        appearance.themeSettings[id] = { ...appearance.themeSettings[id], ...values };
    }
    return Response.json(appearance);
  }
  if (input === '/api/launcher/settings') return Response.json({
    mode: 'native',
    shortcut: 'Ctrl+Alt+Space',
    hotkey: { supported: true, active: true, shortcut: 'Ctrl+Alt+Space' },
  });
  return originalFetch(input, options);
};
const sdk = createCommandService();
const app = createApp({
  render: () => h(SettingsWorkbench, {
    selected: 'interface',
    sections: [{ id: 'interface', title: 'Интерфейс', group: 'Projector', description: 'Окно и оформление', component: InterfaceSettings }],
  }),
});
app.provide(commandHostKey, { createScope: sdk.createScope, revision: ref(0), reportError: console.error });
app.mount('#settings');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  saved: (id = 'frozen-glass') => appearance.themeSettings[id],
  read: () => {
    const settings = document.querySelector('.interface-settings');
    return settings ? {
      color: getComputedStyle(settings).color,
      background: getComputedStyle(document.body).backgroundColor,
    } : null;
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "settings follow the painted scheme without reload",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__appearance_settings": settingsHtml },
    });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_settings"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.interface-settings') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(236, 236, 230)",
        background: "rgb(16, 16, 15)",
      });

      await browser.evaluate("window.fixture.apply('light')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(29, 29, 26)",
        background: "rgb(247, 246, 241)",
      });
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "Frozen Glass applies the wallpaper and panel blur through the settings controls",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__appearance_settings": settingsHtml },
      responses: [
        {
          equals: "/__ice.svg",
          type: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path fill="#7ddcff" d="M0 0h200v200H0z"/><path fill="#152856" d="M0 0h200L0 200z"/></svg>',
        },
      ],
    });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.viewport(1000);
      await browser.open(fixture.url("/__appearance_settings"));
      const scheme = ".interface-settings select:has(option[value='frozen-glass'])";
      const selectScheme = async (value) => {
        await expect
          .poll(() =>
            browser.evaluate(`document.querySelector(${JSON.stringify(scheme)})?.disabled`),
          )
          .toBe(false);
        await browser.evaluate(`(() => {
          const select = document.querySelector(${JSON.stringify(scheme)});
          select.value = ${JSON.stringify(value)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
      };
      await selectScheme("frozen-glass");
      const wallpaper = '.interface-settings input[type="url"]';
      const range = '.interface-settings input[type="range"][max="40"]';
      const backgroundUrl = fixture.url("/__ice.svg");
      await expect
        .poll(() =>
          browser.evaluate(`document.querySelector(${JSON.stringify(wallpaper)})?.disabled`),
        )
        .toBe(false);
      await browser.evaluate(
        `document.querySelector(${JSON.stringify(wallpaper)}).scrollIntoView({ block: 'center' })`,
      );
      await browser.click(wallpaper);
      await browser.call("Input.insertText", { text: backgroundUrl });
      await browser.evaluate(`document.querySelector(${JSON.stringify(range)}).focus()`);
      await browser.key("End");
      const button = ".interface-settings div:has(> input[type=url]) ~ .actions button";
      await browser.evaluate(
        `document.querySelector(${JSON.stringify(button)}).scrollIntoView({ block: 'center' })`,
      );
      await browser.click(button);
      await expect
        .poll(() => browser.evaluate("window.fixture.saved()"))
        .toStrictEqual({
          backgroundUrl,
          blur: 40,
        });
      await expect
        .poll(() =>
          browser.evaluate(
            `getComputedStyle(document.querySelector('.settings-workbench'), '::before').backdropFilter`,
          ),
        )
        .toBe("blur(40px)");
      expect(
        await browser.evaluate("getComputedStyle(document.documentElement).backgroundImage"),
      ).toContain(backgroundUrl);
      expect(
        await browser.evaluate(
          `getComputedStyle(document.querySelector('.settings-workbench')).position`,
        ),
      ).toBe("relative");
      await browser.evaluate(`document.querySelector(${JSON.stringify(range)}).focus()`);
      await browser.key("Home");
      await browser.click(button);
      await expect
        .poll(() =>
          browser.evaluate(
            `getComputedStyle(document.querySelector('.settings-workbench'), '::before').backdropFilter`,
          ),
        )
        .toBe("none");
      await selectScheme("dark");
      await expect
        .poll(() => browser.evaluate("document.documentElement.dataset.theme"))
        .toBe("dark");
      expect(
        await browser.evaluate("getComputedStyle(document.documentElement).backgroundImage"),
      ).toBe("none");
      expect(browser.errors).toEqual([]);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "a trusted theme plugin mounts its own settings widget and saves through the host",
  { skip: !chromium, timeout: 45000 },
  async ({ onTestFinished }) => {
    const id = "widget-example";
    const theme = {
      id: `${id}/glass`,
      packageName: id,
      title: "Widget example",
      mode: "dark",
      tokens: { bg: "#151b27" },
      settings: [{ id: "softness", kind: "blur", title: "Мягкость", default: 8, min: 0, max: 32 }],
    };
    const hash = "a".repeat(64);
    const plugin = {
      id,
      enabled: true,
      trusted: true,
      status: "enabled",
      hash,
      browser: { entry: "dist/browser.js", key: pluginPackageKey(id), hash },
      themes: [theme],
      languages: [],
      panels: [],
      tabs: [],
      diagnostics: [],
    };
    const module = `export default { apiVersion: 1, activate(api) {
      api.themeSettings.register({id: 'glass', mount(root, context) {
        window.widgetSignal = context.signal;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'plugin-theme-demo';
        button.textContent = String(context.getValues().softness);
        button.onclick = async () => {
          const saved = await context.save({softness: 23});
          button.textContent = String(saved.softness);
        };
        root.append(button);
        return () => { window.widgetDisposed = (window.widgetDisposed ?? 0) + 1; };
      }});
    }};`;
    const fixture = await createBrowserFixture({
      pages: {
        "/__plugin_theme": settingsHtml.replace(
          "themes: [],",
          `themes: ${JSON.stringify([theme])},`,
        ),
      },
      responses: [
        { equals: pluginAssetPath(id, hash, "browser.js"), type: "text/javascript", body: module },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/__plugin_theme"));
    const select = `.interface-settings select:has(option[value='${theme.id}'])`;
    await expect
      .poll(() => browser.evaluate(`document.querySelector(${JSON.stringify(select)})?.disabled`), {
        timeout: 5000,
      })
      .toBe(false);
    await browser.evaluate(`(async () => {
      const runtime = await import('/packages/client/modules/plugin-runtime/index.ts');
      window.disableThemeWidget = () => runtime.applyRuntimeCatalog({plugins: []});
      await runtime.applyRuntimeCatalog({plugins: [${JSON.stringify(plugin)}]});
      const select = document.querySelector(${JSON.stringify(select)});
      select.value = ${JSON.stringify(theme.id)};
      select.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await expect
      .poll(() => browser.evaluate("document.querySelector('#plugin-theme-demo')?.textContent"))
      .toBe("8");
    await browser.evaluate(
      "document.querySelector('#plugin-theme-demo').scrollIntoView({block:'center'})",
    );
    await browser.click("#plugin-theme-demo");
    await expect
      .poll(() => browser.evaluate("document.querySelector('#plugin-theme-demo')?.textContent"))
      .toBe("23");
    expect(await browser.evaluate(`window.fixture.saved(${JSON.stringify(theme.id)})`)).toEqual({
      softness: 23,
    });
    expect(
      await browser.evaluate("document.documentElement.style.getPropertyValue('--theme-backdrop')"),
    ).toBe("blur(23px)");
    await browser.evaluate("window.disableThemeWidget()");
    await expect
      .poll(() => browser.evaluate("window.widgetSignal.aborted && window.widgetDisposed === 1"))
      .toBe(true);
    expect(await browser.evaluate("document.querySelector('#plugin-theme-demo') === null")).toBe(
      true,
    );
    expect(
      await browser.evaluate("document.querySelector('input[type=range][max=\"32\"]')?.value"),
    ).toBe("23");
  },
);

const diffHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0">
<div id="diff" style="height:320px"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h } from 'vue';
import CodeViewer from '/packages/client/modules/workspace/modules/viewers/ui/CodeViewer.vue';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
createApp({
  render: () => h(CodeViewer, {
    path: 'probe.ts',
    original: 'const one = 1;\\nconst two = 2;\\nconst three = 3;\\n',
    content: 'const one = 1;\\nconst two = 20;\\nconst three = 3;\\n',
    editable: false,
  }),
}).mount('#diff');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  read: () => {
    const changed = document.querySelector('.cm-changedLine');
    const deleted = document.querySelector('.cm-deletedChunk');
    return {
      changed: changed ? getComputedStyle(changed).backgroundColor : null,
      deleted: deleted ? getComputedStyle(deleted).backgroundColor : null,
    };
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "diff surfaces follow the painted scheme without reload",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__appearance_diff": diffHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_diff"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.cm-changedLine') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");
      const dark = await browser.evaluate("window.fixture.read()");
      expect(dark.changed).not.toBe(null);

      await browser.evaluate("window.fixture.apply('light')");
      const light = await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
        resolve(window.fixture.read());
      }))`);
      expect(light.changed).not.toBe(dark.changed);
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const treeHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0;background:var(--bg)">
<div id="tree"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h, ref } from 'vue';
import FileTree from '/packages/client/modules/workspace/modules/tree/ui/FileTree.vue';
import { createCommandService } from '/packages/core/modules/ide/index.ts';
import { commandHostKey } from '/packages/client/common/utilities/commands.ts';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
const originalFetch = window.fetch;
window.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith('/api/projects/test/workspace/tree')) return Response.json({
    entries: [
      { name: 'src', path: 'src', directory: true, disabled: false },
      { name: 'index.ts', path: 'index.ts', directory: false, disabled: false },
    ],
    total: 2,
    nextOffset: null,
  });
  if (url === '/api/projects/test/workspace/watch') return new Response(null, { status: 204 });
  return originalFetch(input, options);
};
const sdk = createCommandService();
const app = createApp({
  render: () => h(FileTree, { projectId: 'test', selected: '', revision: 0 }),
});
app.provide(commandHostKey, {
  revision: ref(0),
  createScope: sdk.createScope,
  reportError: () => {},
});
app.mount('#tree');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  read: () => {
    const name = document.querySelector('.tree .name');
    return name ? { color: getComputedStyle(name).color } : null;
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "file tree follows the painted scheme without reload",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__appearance_tree": treeHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_tree"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.tree .name') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(165, 165, 157)",
      });

      await browser.evaluate("window.fixture.apply('light')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        color: "rgb(81, 81, 74)",
      });
      expect(await browser.evaluate("window.marker")).toBe(marker);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const terminalHtml = `<!doctype html>
<html lang="ru" data-appearance="dark" data-theme="dark">
<head><meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716"><link rel="icon" href="data:,"></head>
<body style="margin:0;background:var(--bg)">
<div id="terminal" style="height:400px"></div>
<pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import { createApp, h, ref } from 'vue';
import TerminalView from '/packages/client/modules/terminal/ui/TerminalView.vue';
import { createCommandService } from '/packages/core/modules/ide/index.ts';
import { commandHostKey } from '/packages/client/common/utilities/commands.ts';
import { applyAppearance, initAppearance } from '/packages/client/modules/appearance/index.ts';
initAppearance();
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 1;
  onopen = null;
  onmessage = null;
  onclose = null;
  send() {}
  close() { this.readyState = 3; }
}
window.WebSocket = FakeSocket;
const originalFetch = window.fetch;
window.fetch = async (input, options) => {
  if (String(input) === '/api/appearance') return Response.json({
    choice: 'dark',
    fonts: { chat: 13, editor: 13, terminal: 13 },
  });
  return originalFetch(input, options);
};
const sdk = createCommandService();
const app = createApp({
  render: () => h(TerminalView, {
    projectId: 'test',
    session: {
      id: 'session',
      title: 'Shell',
      status: 'running',
      cols: 80,
      rows: 24,
      stopRequested: false,
      exitCode: null,
    },
  }),
});
app.provide(commandHostKey, {
  revision: ref(0),
  createScope: sdk.createScope,
  reportError: () => {},
});
app.mount('#terminal');
window.fixture = {
  ready: true,
  apply: applyAppearance,
  read: () => {
    const viewport = document.querySelector('.xterm-viewport');
    const view = document.querySelector('.terminal-view');
    return viewport && view ? {
      viewport: getComputedStyle(viewport).backgroundColor,
      view: getComputedStyle(view).backgroundColor,
    } : null;
  },
};
window.marker = Math.random();
</script>
</body></html>`;

test(
  "terminal follows the painted scheme without reload",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__appearance_terminal": terminalHtml },
    });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__appearance_terminal?terminalTransport=legacy"));
      await browser.evaluate(`new Promise((resolve) => {
        const tick = () => document.querySelector('.xterm-viewport') ? resolve(true) : setTimeout(tick, 20);
        tick();
      })`);
      const marker = await browser.evaluate("window.marker");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        viewport: "rgb(23, 23, 22)",
        view: "rgb(23, 23, 22)",
      });

      await browser.evaluate("window.fixture.apply('light')");
      await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(resolve))`);
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        viewport: "rgb(239, 238, 232)",
        view: "rgb(239, 238, 232)",
      });
      expect(await browser.evaluate("window.marker")).toBe(marker);
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
