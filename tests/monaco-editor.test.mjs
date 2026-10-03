import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, loadConfigFromFile } from "vite-plus";

const chromium = [process.env.CHROMIUM_BIN, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
  .filter(Boolean).find(existsSync);

const waitHelper = `const wait = async (condition, label) => {
      const until = Date.now() + 6000;
      while(!condition()) {
        if(Date.now() > until) throw new Error('Monaco did not render: ' + label);
        await fetch('/__tick');
      }
    };
    const check = (condition, message) => {if(!condition) throw new Error(message);};`;

test("lazy Monaco renders from a cold cache and after an in-process Vite restart", {
  skip: chromium ? false : "Set CHROMIUM_BIN to run the Monaco browser regression",
  timeout: 60000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-monaco-browser-"));
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
  const includes = loaded.config.optimizeDeps.include;
  const html = `<!doctype html><div id="editor" style="height:400px"></div><pre id="result">WAITING</pre>
  <script type="module">
    import {createApp, defineAsyncComponent, h, nextTick, ref} from 'vue';
    const show = ref(false);
    const CodeViewer = defineAsyncComponent(() => import('/src/modules/workspace/ui/CodeViewer.vue'));
    const path = ref('probe.json'), content = ref('{"alive":true}'), original = ref(undefined);
    const app = createApp({render: () => show.value ? h(CodeViewer, {
      path:path.value, content:content.value, original:original.value, editable:original.value === undefined,
    }) : null});
    app.mount('#editor');
    ${waitHelper}
    setTimeout(async () => {
      try {
        show.value = true;
        await wait(() => document.querySelector('.monaco-editor .view-line'), 'initial editor');
        const {monaco} = await import('/src/modules/workspace/lib/monaco.ts');
        check(monaco.editor.getModels()[0].getValue() === content.value, 'JSON file content');
        check(monaco.editor.getModels()[0].getLanguageId() === 'json', 'JSON language');
        path.value = 'probe.ts'; content.value = 'const alive = true;'; await nextTick();
        check(monaco.editor.getModels()[0].getLanguageId() === 'typescript', 'Switching file language');
        check(monaco.editor.getModels()[0].getValue() === content.value, 'Switching file content');
        original.value = 'const alive = false;'; await nextTick();
        await wait(() => document.querySelector('.monaco-diff-editor'), 'diff editor');
        check(monaco.editor.getModels().length === 2, 'Git diff models');
        app.unmount();
        check(monaco.editor.getModels().length === 0, 'Models disposed');
        document.getElementById('result').textContent = 'PASS';
      } catch(error) {document.getElementById('result').textContent = 'FAIL: ' + error.stack;}
    }, 100);
  </script>`;
  const gutterHtml = `<!doctype html><div id="editor" style="height:400px"></div><pre id="result">WAITING</pre>
  <script type="module">
    import '/src/app/styles.css';
    import {createApp, defineAsyncComponent, h} from 'vue';
    const CodeViewer = defineAsyncComponent(() => import('/src/modules/workspace/ui/CodeViewer.vue'));
    const content = Array.from({length:10}, (_, i) => 'line' + (i + 1)).join(String.fromCharCode(10)) + String.fromCharCode(10);
    const app = createApp({render: () => h(CodeViewer, {path:'probe.ts', content, editable:true, projectId:'p1', revision:0})});
    app.mount('#editor');
    ${waitHelper}
    (async () => {
      try {
        await wait(() => document.querySelector('.git-gutter-added'), 'git gutter');
        const {monaco} = await import('/src/modules/workspace/lib/monaco.ts');
        const editor = monaco.editor.getEditors()[0];
        const lineOf = (element) => element.parentElement.querySelector('.line-numbers')?.textContent;
        const lines = (kind) => [...document.querySelectorAll('.git-gutter-' + kind)].map(lineOf).join(',');
        await wait(() => document.querySelector('.git-gutter-modified') && document.querySelector('.git-gutter-deleted'), 'all gutter kinds');
        check(lines('added') === '2,3', 'Gutter add lines: ' + lines('added'));
        check(lines('modified') === '5', 'Gutter modify line: ' + lines('modified'));
        check(lines('deleted') === '7', 'Gutter delete line: ' + lines('deleted'));
        const added = document.querySelector('.git-gutter-added');
        const modified = document.querySelector('.git-gutter-modified');
        const deleted = document.querySelector('.git-gutter-deleted');
        check(getComputedStyle(added, '::before').backgroundColor === 'rgb(143, 191, 138)', 'Gutter add color');
        check(getComputedStyle(modified, '::before').backgroundColor === 'rgb(127, 176, 214)', 'Gutter modify color');
        check(getComputedStyle(deleted, '::after').borderLeftColor === 'rgb(209, 149, 133)', 'Gutter delete color');

        const model = editor.getModel();
        model.applyEdits([{range: new monaco.Range(9, 1, 9, 1), text: 'typed '}]);
        await wait(() => lines('modified') === '5,9', 'live update while typing');

        editor.setPosition({lineNumber: 1, column: 1});
        await editor.getAction('projector.dirty-diff.next').run();
        check(editor.getPosition().lineNumber === 2, 'Next change jumps to line 2');
        await wait(() => document.querySelector('.dirty-diff-peek'), 'peek');
        check(document.querySelector('.dirty-diff-title').textContent === 'Изменение 1 из 4', 'Peek title');
        document.querySelector('.dirty-diff-peek button[title="Откатить изменение"]').click();
        await wait(() => !document.querySelector('.dirty-diff-peek') && lines('added') === '', 'revert added lines');
        check(model.getLineCount() === 9, 'Revert removes added lines');

        await editor.getAction('projector.dirty-diff.next').run();
        await wait(() => document.querySelector('.dirty-diff-peek'), 'second peek');
        document.querySelector('.dirty-diff-peek button[title="Откатить изменение"]').click();
        await wait(() => lines('modified') === '7', 'revert modified line');
        editor.setPosition({lineNumber: 1, column: 1});
        await editor.getAction('projector.dirty-diff.next').run();
        await wait(() => document.querySelector('.dirty-diff-peek'), 'peek for deletion');
        document.querySelector('.dirty-diff-peek button[title="Откатить изменение"]').click();
        await wait(() => !document.querySelector('.git-gutter-deleted') && lines('modified') === '8', 'deletion reverted');
        check(model.getValue().split(String.fromCharCode(10)).includes('gone'), 'Revert restores the deleted line');
        document.getElementById('result').textContent = 'PASS';
      } catch(error) {document.getElementById('result').textContent = 'FAIL: ' + error.stack;}
    })();
  </script>`;
  const fixture = {
    name: "monaco-test-fixture",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const page = req.url === "/__monaco_test" ? html : req.url === "/__gutter_test" ? gutterHtml : null;
        if (page) {
          res.setHeader("Content-Type", "text/html");
          void server.transformIndexHtml(req.url, page).then(body => res.end(body));
          return;
        }
        if (req.url === "/__tick") {
          // Real elapsed time: virtual time would outrun Monaco's editor worker.
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
          res.end(JSON.stringify({ available: true, original: ['line1', 'line4', 'old5', 'line6', 'line7', 'gone', 'line8', 'line9', 'line10', ''].join('\n') }));
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
    plugins: [...loaded.config.plugins.filter(plugin => plugin.name !== "projector-api"), fixture],
    cacheDir: join(directory, "vite-cache"),
    optimizeDeps: { ...loaded.config.optimizeDeps, entries: [] },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "error",
  });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const dump = async (path, profile) => {
    const { stdout, stderr } = await promisify(execFile)(chromium, [
      "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(directory, profile)}`, "--virtual-time-budget=15000", "--dump-dom",
      `${base}${path}`,
    ], { timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
    return stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? stdout.slice(-2000) + stderr.slice(-1000);
  };
  for (const phase of ["cold", "restarted"]) {
    if (phase === "restarted") await server.restart();
    assert.equal(await dump("/__monaco_test", `monaco-${phase}`), "PASS", `${phase} Monaco failed`);
    const source = await (await fetch(`${base}/src/modules/workspace/lib/monaco.ts`)).text();
    const urls = [...source.matchAll(/"(\/[^"\n]+\/deps\/monaco[^"\n]+)"/g)].map(match => match[1]);
    assert.equal(urls.length, includes.length, 'Every Monaco entry must be prebundled');
    for (const url of urls) assert.equal((await fetch(`${base}${url}`)).status, 200, url);
    assert.equal(await dump("/__gutter_test", `gutter-${phase}`), "PASS", `${phase} Git gutter failed`);
  }
});
