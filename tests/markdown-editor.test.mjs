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
    import '/src/app/styles.css';
    import MarkdownViewer from '/src/modules/workspace/ui/MarkdownViewer.vue';
    import {createCommandService, defaultKeybindings} from '/core/modules/ide/index.ts';
    const initial = "# Title\\r\\n\\r\\nA **bold** paragraph.\\r\\n\\r\\n![Alt text](../image.png)\\r\\n\\r\\n| A | B |\\r\\n| - | - |\\r\\n| One | Two |\\r\\n\\r\\n~~~js\\r\\nconst value = 1;\\r\\n~~~\\r\\n\\r\\n\\u003cdetails>\\u003csummary>More\\u003c/summary>Raw HTML\\u003c/details>\\r\\n\\r\\n\\u003cscript>window.unsafeMarkdown = true\\u003c/script>\\r\\n";
    const content = ref(initial); let changes = 0; let failure = ''; let saves = 0; let saved = ''; const opened = [];
    const app = createApp({ render: () => h(MarkdownViewer, { mode: 'document', path: 'docs/test.md', projectId: 'test', content: content.value, onSave: () => { saves++; saved = content.value; }, onChange: value => { changes++; content.value = value; }, onOpen: path => opened.push(path), onError: message => failure = message }) });
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
      // Reproduce the paint-order failure with an opaque, positioned quote.
      content.value = '> Quote text\\n\\n> > Nested quote\\n'; await nextTick();
      const quoteSelection = window.getSelection();
      for (const quote of editor.querySelectorAll('blockquote')) {
        const paragraph = quote.querySelector('p');
        const quoteRange = document.createRange();
        quoteRange.setStart(paragraph.firstChild, 3); quoteRange.collapse(true);
        quoteSelection.removeAllRanges(); quoteSelection.addRange(quoteRange); editor.focus();
        await wait(() => {
          const caret = editor.querySelector('.prosemirror-virtual-cursor');
          if (!caret) return false;
          const cursorRect = caret.getBoundingClientRect();
          const textRect = quoteRange.getBoundingClientRect();
          return Math.abs(cursorRect.x - textRect.x) < 3 && Math.abs(cursorRect.y - textRect.y) < 3;
        });
        const caret = editor.querySelector('.prosemirror-virtual-cursor');
        // Hit-test the actual paint order, temporarily enabling pointer events.
        caret.style.pointerEvents = 'auto';
        try {
          const rect = caret.getBoundingClientRect();
          check(document.elementFromPoint(rect.x + 1, rect.y + 5) === caret, 'The caret must paint above quote backgrounds, including nested quotes');
        } finally { caret.style.removeProperty('pointer-events'); }
      }
      content.value = initial; await nextTick();
      changes = 0;
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
      const links = '# Links\\n\\n[**Local**](../README.md) [Nested](guide/start.md) [Encoded](./hello%20world.md) [Web](https://example.com/docs) [HTTP](http://example.com) [Protocol relative](//example.com/docs)\\n\\n<div><a href="../package.json"><strong>HTML link</strong></a></div>\\n';
      content.value = links; await nextTick();
      const linkChanges = changes;
      const local = editor.querySelector('a[href="../README.md"]');
      check(local, 'Relative Markdown links must render');
      local.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
      check(opened.length === 0, 'Ordinary click must keep document links editable');
      // An editor/node-view listener must not swallow navigation before our handler runs.
      local.addEventListener('click', event => event.stopPropagation());
      local.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true,ctrlKey:true,button:0}));
      local.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,ctrlKey:true,button:0}));
      check(opened.join() === 'README.md', 'Ctrl+click on link text must open the project file once');
      editor.querySelector('a[href="guide/start.md"]').dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,ctrlKey:true}));
      editor.querySelector('a[href="./hello%20world.md"]').dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,metaKey:true}));
      editor.querySelector('.markdown-html a strong').dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,ctrlKey:true}));
      check(opened.join('|') === 'README.md|docs/guide/start.md|docs/hello world.md|package.json', 'Relative, encoded and HTML paths must resolve against the current document');
      const external = []; const originalOpen = window.open;
      window.open = (...args) => { external.push(args); return null; };
      try {
        for (const href of ['https://example.com/docs', 'http://example.com', '//example.com/docs']) {
          editor.querySelector('a[href="'+href+'"]').dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,ctrlKey:true}));
        }
        check(external.length === 3 && external.every(args => args[1] === '_blank' && args[2] === 'noopener,noreferrer'), 'HTTP(S) links must open in a new tab');
        const preview = document.querySelector('.milkdown-link-preview');
        check(preview, 'The editor link preview must exist');
        // Its anchor is outside the editable document and should follow a plain click.
        const previewLink = document.createElement('a'); previewLink.href = '../preview.md'; preview.append(previewLink);
        previewLink.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
        check(opened.at(-1) === 'preview.md', 'A relative link in the floating preview must open inside the project');
        previewLink.href = 'https://example.com/preview';
        previewLink.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
        check(external.at(-1)[0] === 'https://example.com/preview', 'An HTTP preview link must open in a new tab');
        previewLink.remove();
      } finally { window.open = originalOpen; }
      check(changes === linkChanges && content.value === links, 'Following links must not edit the Markdown');
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
