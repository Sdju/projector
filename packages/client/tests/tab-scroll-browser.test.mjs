import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<html lang="ru">
<head><link rel="icon" href="data:,"><style>
  .host { width: 320px; height: 180px; overflow: hidden; }
  .kept-panel { height: 100%; }
  .content { display: block; height: 180px; overflow: auto; }
  .spacer { height: 900px; flex-shrink: 0; }
</style></head>
<body>
  <div id="one" class="host"></div><div id="two" class="host"></div><div id="three" class="host"></div>
  <div id="app"></div><pre id="result">WAITING</pre>
  <script type="module">
    import { createApp, h, nextTick, ref } from 'vue';
    import KeptPanel from '/packages/client/modules/workspace/ui/KeptPanel.vue';
    const target = ref(document.getElementById('one'));
    const Content = {
      props: { projectId: { type: String, required: true } },
      setup: (props) => () => h('div', { class: 'content', 'data-project-id': props.projectId }, [
        h('input', { id: 'draft' }),
        h('div', { class: 'spacer' }),
      ]),
    };
    const app = createApp({
      render: () => h(KeptPanel, {
        id: 'settings', to: target.value, component: Content, viewProps: { projectId: 'scroll-test' },
      }),
    });
    app.mount('#app');
    window.fixture = {
      ready: true,
      move: async (id) => {
        target.value = id ? document.getElementById(id) : null;
        await nextTick();
      },
      read: () => ({
        top: document.querySelector('.content').scrollTop,
        draft: document.getElementById('draft').value,
      }),
    };
    document.getElementById('result').textContent = 'PASS';
  </script>
</body></html>`;

test(
  "kept tabs restore nested scroll after teleporting between panel hosts",
  { skip: !chromium, timeout: 45000, retry: 1 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__tab_scroll": html } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__tab_scroll"));
      expect(await browser.evaluate("document.querySelector('.content').dataset.projectId")).toBe(
        "scroll-test",
      );
      await browser.evaluate(
        "document.querySelector('.content').scrollTop = 240; document.getElementById('draft').value = 'черновик'; new Promise(resolve => setTimeout(resolve, 50))",
      );
      expect(await browser.evaluate("document.querySelector('.content').scrollTop")).toBe(240);
      await browser.evaluate("window.fixture.move(null)");
      expect((await browser.evaluate("window.fixture.read()")).top).toBe(0);
      await browser.evaluate("window.fixture.move('two')");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        top: 240,
        draft: "черновик",
      });

      await browser.evaluate(
        "document.querySelector('.content').scrollTop = 360; new Promise(resolve => setTimeout(resolve, 50))",
      );
      await browser.evaluate("window.fixture.move('three')");
      expect(await browser.evaluate("window.fixture.read()")).toStrictEqual({
        top: 360,
        draft: "черновик",
      });
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

const filesHtml = `<!doctype html>
<html lang="ru">
<head><link rel="icon" href="data:,"><style>#app { display: flex; height: 320px; }</style></head>
<body><div id="app"></div><pre id="result">WAITING</pre><script type="module">
  import { createApp, h, nextTick, ref } from 'vue';
  import '/packages/client/app/styles.css';
  import FilePanel from '/packages/client/modules/workspace/ui/FilePanel.vue';
  const visible = ref(true);
  const kind = ref('code');
  const files = {
    code: { key: 'code', path: 'large.js', content: Array.from({length: 300}, (_, i) => 'const value' + i + ' = ' + i).join('\\n') },
    markdown: { key: 'markdown', path: 'large.md', content: Array.from({length: 100}, (_, i) => '## Раздел ' + i + '\\n\\nТекст раздела.').join('\\n\\n') },
  };
  const app = createApp({ render: () => visible.value
    ? h(FilePanel, { key: kind.value, file: files[kind.value], projectId: 'test', revision: 0 })
    : h('div') });
  app.provide(Symbol.for('projector.workspace-tabs'), { views: {}, types: { get: () => undefined } });
  app.provide(Symbol.for('projector.tab-host'), {});
  app.mount('#app');
  window.fixture = {
    ready: true,
    hide: async () => { visible.value = false; await nextTick(); },
    show: async (next) => { kind.value = next; visible.value = true; await nextTick(); },
    saved: (next) => files[next].scroll,
  };
  document.getElementById('result').textContent = 'PASS';
</script></body></html>`;

test(
  "file tabs restore CodeMirror and visual Markdown scroll after remounting",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__file_scroll": filesHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.open(fixture.url("/__file_scroll"));
      const wait = (selector) =>
        browser.evaluate(`new Promise((resolve, reject) => {
          const start = Date.now();
          const poll = () => {
            if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
            if (Date.now() - start > 20000) return reject(new Error('No ${selector}'));
            setTimeout(poll, 20);
          };
          poll();
        })`);
      await wait(".cm-scroller");
      await browser.evaluate(
        "document.querySelector('.cm-scroller').scrollTop = 480; new Promise(resolve => setTimeout(resolve, 50))",
      );
      expect(await browser.evaluate("document.querySelector('.cm-scroller').scrollTop")).toBe(480);
      expect(await browser.evaluate("window.fixture.saved('code')")).toBeDefined();
      await browser.evaluate("window.fixture.hide(); window.fixture.show('code')");
      await wait(".cm-scroller");
      expect(await browser.evaluate("document.querySelector('.cm-scroller').scrollTop")).toBe(480);

      await browser.evaluate("window.fixture.show('markdown')");
      await wait(".visual-markdown .ProseMirror");
      await browser.evaluate(
        "document.querySelector('.visual-markdown').scrollTop = 520; new Promise(resolve => setTimeout(resolve, 50))",
      );
      await browser.evaluate("window.fixture.hide(); window.fixture.show('markdown')");
      await wait(".visual-markdown .ProseMirror");
      expect(await browser.evaluate("document.querySelector('.visual-markdown').scrollTop")).toBe(
        520,
      );
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);
