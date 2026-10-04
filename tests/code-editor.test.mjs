import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, loadConfigFromFile } from "vite-plus";

const chromium = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);

const helpers = `const wait = async (condition, label) => {
      const until = Date.now() + 6000;
      while(!condition()) {
        if(Date.now() > until) throw new Error('Editor did not render: ' + label);
        await fetch('/__tick');
      }
    };
    const check = (condition, message) => {if(!condition) throw new Error(message);};
    const nl = String.fromCharCode(10);`;

const page = (
  body,
) => `<!doctype html><div id="editor" style="height:400px"></div><pre id="result">WAITING</pre>
  <script type="module">
    import '/src/app/styles.css';
    import {createApp, defineAsyncComponent, h, nextTick, ref} from 'vue';
    import {EditorView} from '@codemirror/view';
    const CodeViewer = defineAsyncComponent(() => import('/src/modules/workspace/modules/viewers/ui/CodeViewer.vue'));
    ${helpers}
    const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const text = () => view().state.doc.toString();
    const click = (element) => element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, button: 0}));
    const mount = (props) => createApp({render: () => h(CodeViewer, props.value)}).mount('#editor');
    ${body}
  </script>`;

const filePage = page(`
    const props = ref({path: 'probe.json', content: '{"alive":true}', editable: true});
    mount(props);
    (async () => {
      try {
        await wait(() => document.querySelector('.cm-editor .cm-line'), 'initial editor');
        check(text() === '{"alive":true}', 'JSON content');
        await wait(() => document.querySelector('.cm-line span'), 'JSON highlighting');
        props.value = {path: 'probe.ts', content: 'const alive = true;', editable: true};
        await nextTick();
        await wait(() => text() === 'const alive = true;', 'switched content');
        await wait(() => document.querySelector('.cm-line span'), 'TypeScript highlighting');
        props.value = {path: 'probe.ts', content: 'const alive = true;', original: 'const alive = false;', editable: false};
        await nextTick();
        await wait(() => document.querySelector('.cm-deletedChunk'), 'inline diff');
        document.querySelector('.diff-layout button[title="Две колонки"]').click();
        await wait(() => document.querySelectorAll('.cm-mergeView .cm-editor').length === 2, 'side-by-side diff');
        check(document.querySelector('.diff-side') !== null, 'Diff header');
        document.getElementById('result').textContent = 'PASS';
      } catch(error) {document.getElementById('result').textContent = 'FAIL: ' + error.stack;}
    })();`);

const diffEditPage = page(`
    window.__last = undefined;
    mount(ref({path: 'probe.ts', content: 'one' + nl + 'two' + nl, original: 'one' + nl + 'old' + nl, editable: true,
      onChange: (value) => { window.__last = value; }}));
    (async () => {
      try {
        await wait(() => document.querySelector('.diff-revert'), 'revert button');
        click(document.querySelector('.diff-revert'));
        await wait(() => window.__last === 'one' + nl + 'old' + nl, 'revert emits original text: ' + JSON.stringify(window.__last));
        document.getElementById('result').textContent = 'PASS';
      } catch(error) {document.getElementById('result').textContent = 'FAIL: ' + error.stack;}
    })();`);

const gutterPage = page(`
    const content = Array.from({length:10}, (_, i) => 'line' + (i + 1)).join(nl) + nl;
    mount(ref({path: 'probe.ts', content, editable: true, projectId: 'p1', revision: 0}));
    // The gutter keeps a hidden spacer element that carries a marker too.
    const markers = (kind) => document.querySelectorAll('.cm-dirty-gutter .cm-gutterElement:not([style*="hidden"]) .git-gutter-' + kind);
    const count = (kind) => markers(kind).length;
    const marker = (kind) => markers(kind)[0].closest('.cm-gutterElement');
    (async () => {
      try {
        await wait(() => count('added') === 2, 'git gutter');
        check(count('added') === 2, 'Gutter add lines: ' + count('added'));
        check(count('modified') === 1, 'Gutter modify lines: ' + count('modified'));
        check(count('deleted') === 1, 'Gutter delete markers: ' + count('deleted'));
        check(getComputedStyle(markers('added')[0]).backgroundColor === 'rgb(143, 191, 138)', 'Gutter add color');

        view().dispatch({changes: {from: text().indexOf('line9'), insert: 'typed '}});
        await wait(() => count('modified') === 2, 'live update while typing');

        click(marker('added'));
        await wait(() => document.querySelector('.dirty-diff-peek'), 'peek');
        check(document.querySelector('.dirty-diff-title').textContent === 'Изменение 1 из 4', 'Peek title');
        document.querySelector('.dirty-diff-button[title="Откатить изменение"]').click();
        await wait(() => !document.querySelector('.dirty-diff-peek') && count('added') === 0, 'revert added lines');
        check(!text().includes('line2'), 'Revert removes added lines');

        click(marker('modified'));
        await wait(() => document.querySelector('.dirty-diff-peek'), 'second peek');
        document.querySelector('.dirty-diff-button[title="Откатить изменение"]').click();
        await wait(() => text().includes('old5'), 'revert modified line');

        click(marker('deleted'));
        await wait(() => document.querySelector('.dirty-diff-peek'), 'peek for deletion');
        document.querySelector('.dirty-diff-button[title="Откатить изменение"]').click();
        await wait(() => count('deleted') === 0 && text().includes('gone'), 'deletion reverted');
        document.getElementById('result').textContent = 'PASS';
      } catch(error) {document.getElementById('result').textContent = 'FAIL: ' + error.stack;}
    })();`);

test(
  "CodeMirror editor renders files, diffs and Git markers, also after an in-process Vite restart",
  {
    skip: chromium ? false : "Set CHROMIUM_BIN to run the editor browser regression",
    timeout: 90000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-editor-browser-"));
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
    const pages = {
      "/__file_test": filePage,
      "/__diff_edit_test": diffEditPage,
      "/__gutter_test": gutterPage,
    };
    const fixture = {
      name: "editor-test-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const html = pages[req.url];
          if (html) {
            res.setHeader("Content-Type", "text/html");
            void server.transformIndexHtml(req.url, html).then((body) => res.end(body));
            return;
          }
          if (req.url === "/__tick") {
            setTimeout(() => res.end("ok"), 20);
            return;
          }
          if (req.url.startsWith("/api/ide/")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ theme: "projector" }));
            return;
          }
          if (req.url.startsWith("/api/projects/") && req.url.includes("/workspace/gutter")) {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                available: true,
                original: [
                  "line1",
                  "line4",
                  "old5",
                  "line6",
                  "line7",
                  "gone",
                  "line8",
                  "line9",
                  "line10",
                  "",
                ].join("\n"),
              }),
            );
            return;
          }
          next();
        });
      },
    };
    const server = await createServer({
      ...loaded.config,
      configFile: false,
      // Never attach Projector's API/PTY server or write its instance file in this fixture.
      plugins: [
        ...loaded.config.plugins.filter((plugin) => plugin.name !== "projector-api"),
        fixture,
      ],
      cacheDir: join(directory, "vite-cache"),
      optimizeDeps: { ...loaded.config.optimizeDeps, entries: [] },
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      logLevel: "error",
    });
    t.after(async () => {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const dump = async (path, profile) => {
      const { stdout, stderr } = await promisify(execFile)(
        chromium,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(directory, profile)}`,
          "--virtual-time-budget=15000",
          "--dump-dom",
          `${base}${path}`,
        ],
        { timeout: 25000, maxBuffer: 2 * 1024 * 1024 },
      );
      return (
        stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ??
        stdout.slice(-2000) + stderr.slice(-1000)
      );
    };
    for (const phase of ["cold", "restarted"]) {
      if (phase === "restarted") await server.restart();
      for (const path of Object.keys(pages)) {
        assert.equal(
          await dump(path, `${path.slice(3)}-${phase}`),
          "PASS",
          `${phase} ${path} failed`,
        );
      }
    }
  },
);
