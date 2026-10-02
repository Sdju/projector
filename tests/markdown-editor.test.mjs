import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite-plus";
import vue from "@vitejs/plugin-vue";

const chromium =
  process.env.CHROMIUM_BIN ??
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);

test(
  "visual Markdown: synchronous drafts, undo, media and source round trips",
  {
    skip: chromium ? false : "Set CHROMIUM_BIN to run the visual editor regression",
    timeout: 60000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-markdown-browser-"));
    const fixturePlugin = {
      name: "markdown-test-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.startsWith("/api/projects/")) {
            res.setHeader("Content-Type", "image/svg+xml");
            res.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>',
            );
            return;
          }
          if (req.url === "/favicon.ico") {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.url !== "/__markdown_test") return next();
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          void server.transformIndexHtml(req.url, html).then((page) => res.end(page));
        });
      },
    };
    const server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("..", import.meta.url)),
      cacheDir: join(directory, "vite-cache"),
      plugins: [vue(), fixturePlugin],
      optimizeDeps: { entries: [] },
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0 },
    });
    t.after(async () => {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const html = `<!doctype html><div id="editor"></div><button id="outside">Outside editor</button><pre id="result">WAITING</pre><script type="module">
    import { createApp, h, nextTick, ref } from 'vue';
    import MarkdownViewer from '/src/modules/workspace/ui/MarkdownViewer.vue';
    import {createCommandService, defaultKeybindings} from '/core/modules/ide/index.ts';
    const initial = "# Title\\r\\n\\r\\nA **bold** paragraph.\\r\\n\\r\\n![Alt text](../image.png)\\r\\n\\r\\n| A | B |\\r\\n| - | - |\\r\\n| One | Two |\\r\\n\\r\\n~~~js\\r\\nconst value = 1;\\r\\n~~~\\r\\n\\r\\n\\u003cdetails>\\u003csummary>More\\u003c/summary>Raw HTML\\u003c/details>\\r\\n\\r\\n\\u003cscript>window.unsafeMarkdown = true\\u003c/script>\\r\\n";
    const content = ref(initial); let changes = 0; let failure = ''; let saves = 0; let saved = '';
    const app = createApp({ render: () => h(MarkdownViewer, { mode: 'document', path: 'docs/test.md', projectId: 'test', content: content.value, onSave: () => { saves++; saved = content.value; }, onChange: value => { changes++; content.value = value; }, onError: message => failure = message }) });
    app.mount('#editor');
    const sdk = createCommandService(defaultKeybindings);
    const scope = sdk.createScope('editor', () => ({surface:'editor'}));
    scope.registerCommand({id:'ide.editor.file.save',title:'Save',run:() => {saves++; saved=content.value;}});
    document.getElementById('editor').addEventListener('keydown', event => {
      const binding=scope.resolveKeybinding(event,true);
      if(binding){event.preventDefault();event.stopPropagation();void scope.executeCommand(binding.command,binding.args);}
    },true);
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async (predicate) => { for (let n = 0; n < 200; n++) { if (failure) throw new Error(failure); if (predicate()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Editor did not become ready'); };
    try {
      await wait(() => document.querySelector('[aria-label="Редактор документа Markdown"]'));
      check(changes === 0, 'Opening the document must not create a draft');
      const editor = document.querySelector('.milkdown .ProseMirror');
      check(!document.querySelector('.markdown-toolbar'), 'There must be no upper toolbar');
      check(editor.contentEditable === 'true', 'The formatted document must be editable');
      check(editor.querySelector('strong').textContent === 'bold', 'Bold must render visually');
      const image = editor.querySelector('img:not(.ProseMirror-separator)');
      check(image && image.getAttribute('src').includes('workspace/asset?path=image.png'), 'Local image must render through the project asset endpoint');
      check(!window.unsafeMarkdown && !editor.querySelector('script'), 'Embedded scripts must not execute');
      const heading = editor.querySelector('h1');
      const range = document.createRange(); range.selectNodeContents(heading); range.collapse(false);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); editor.focus();
      document.execCommand('insertText', false, ' edited');
      await Promise.resolve(); await nextTick();
      check(content.value.startsWith('# Title edited'), 'The draft must update in the same transaction, before Ctrl+S or unmount');
      editor.dispatchEvent(new KeyboardEvent('keydown', {key:'s', code:'KeyS', ctrlKey:true, bubbles:true, cancelable:true}));
      check(saved === content.value && saves === 1, 'Ctrl+S must save the latest visual edit');
      sdk.setKeybindings([{key:'Mod+Shift+S',command:'ide.editor.file.save',allowInput:true}]);
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}));
      check(saves===1,'The old Ctrl+S binding must stop saving after a remap');
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));
      check(saves===2 && saved===content.value,'The remapped shortcut must save the current draft');
      document.getElementById('outside').focus();
      check(saved === content.value && saves === 3, 'Losing focus must save without a button');
      editor.focus();
      check(content.value.includes('![Alt text](../image.png)'), 'Image path and alt text must survive an edit elsewhere');
      check(content.value.includes('<details><summary>More</summary>Raw HTML</details>'), 'Raw HTML must survive edits');
      check(content.value.includes('const value = 1;') && content.value.includes('One') && content.value.includes('Two'), 'Code and table content must survive edits');
      check(!content.value.split(String.fromCharCode(13, 10)).join('').includes(String.fromCharCode(10)), 'CRLF must survive edits');
      editor.dispatchEvent(new KeyboardEvent('keydown', {key:'z', code:'KeyZ', ctrlKey:true, bubbles:true,cancelable:true}));
      await Promise.resolve(); await nextTick();
      check(content.value === initial, 'Undo must restore the original Markdown byte for byte');
      content.value = '# From source\\n\\nNew **text**.\\n'; await nextTick();
      check(editor.querySelector('h1').textContent === 'From source', 'Source changes must update the visual document');
      check(editor.querySelector('strong').textContent === 'text', 'Source formatting must render');
      app.unmount();
      document.getElementById('result').textContent = 'PASS';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
  </script>`;
    await server.listen();
    const port = server.httpServer.address().port;
    const { stdout } = await promisify(execFile)(
      chromium,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${join(directory, "profile")}`,
        "--virtual-time-budget=10000",
        "--dump-dom",
        `http://127.0.0.1:${port}/__markdown_test`,
      ],
      { timeout: 50000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.equal(stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1], "PASS");
  },
);
