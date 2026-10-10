import { expect, onTestFinished, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";

const chromium = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);

const statusLinePage = `<!doctype html><div id="app" style="height:420px"></div><pre id="result">WAITING</pre>
  <script type="module">
    import '/src/app/styles.css';
    import {createApp, defineAsyncComponent, h, nextTick} from 'vue';
    import {EditorView} from '@codemirror/view';
    import {provideEditorStatus} from '/src/modules/workspace/modules/viewers/lib/editor-status.ts';
    import EditorStatusLine from '/src/modules/workspace/modules/viewers/ui/EditorStatusLine.vue';
    const CodeViewer = defineAsyncComponent(() => import('/src/modules/workspace/modules/viewers/ui/CodeViewer.vue'));
    const wait = async (condition, label) => {
      const until = Date.now() + 6000;
      while(!condition()) {
        if(Date.now() > until) throw new Error('Status line did not render: ' + label);
        await fetch('/__tick');
      }
    };
    const check = (condition, message) => {if(!condition) throw new Error(message);};
    const nl = String.fromCharCode(10);
    const content = 'const alive = true;' + nl + 'let n = 2;' + nl;
    const Root = {setup(){
      provideEditorStatus();
      return () => h('div', {style:'display:flex;flex-direction:column;height:420px'}, [
        h(CodeViewer, {path:'probe.ts', content, editable:true}),
        h(EditorStatusLine, {path:'probe.ts', content}),
      ]);
    }};
    createApp(Root).mount('#app');
    (async () => {
      try {
        const line = () => document.querySelector('.editor-status-line')?.textContent ?? '';
        await wait(() => document.querySelector('.cm-line'), 'editor');
        await wait(() => line().includes('Строка 1, столбец 1'), 'initial cursor');
        check(line().includes('TypeScript'), 'language label: ' + line());
        check(/(^|[^A-Z])LF/.test(line()), 'line ending: ' + line());
        const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
        view.dispatch({selection: {anchor: view.state.doc.line(2).from + 4}});
        await nextTick();
        await wait(() => line().includes('Строка 2, столбец 5'), 'cursor follows selection');
        document.getElementById('result').textContent = 'PASS';
      } catch(error) {document.getElementById('result').textContent = 'FAIL: ' + error.stack;}
    })();
  </script>`;

test(
  "File tab status line shows cursor, syntax language and line ending",
  { skip: !chromium, timeout: 60000, retry: 2 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__status_line_test": statusLinePage },
    });
    onTestFinished(() => fixture.close());
    const { directory } = fixture;
    const { stdout, stderr } = await promisify(execFile)(
      chromium,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${join(directory, "status-line")}`,
        "--virtual-time-budget=15000",
        "--dump-dom",
        fixture.url("/__status_line_test"),
      ],
      { timeout: 25000, maxBuffer: 2 * 1024 * 1024 },
    );
    const result =
      stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ??
      stdout.slice(-2000) + stderr.slice(-1000);
    expect(result).toBe("PASS");
  },
);
