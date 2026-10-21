import { expect, onTestFinished, test } from "vite-plus/test";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

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
    import {provideEditorStatus} from '/src/modules/workspace/modules/viewers/lib/editor-status.ts';
    import EditorStatusLine from '/src/modules/workspace/modules/viewers/ui/EditorStatusLine.vue';
    const CodeViewer = defineAsyncComponent(() => import('/src/modules/workspace/modules/viewers/ui/CodeViewer.vue'));
    ${helpers}
    const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const text = () => view().state.doc.toString();
    const click = (element) => element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, button: 0}));
    const mount = (props) => createApp({setup() {
      provideEditorStatus();
      return () => h('div', {style:'display:flex;flex-direction:column;height:400px'}, [
        h(CodeViewer, props.value), h(EditorStatusLine, {path:props.value.path, content:props.value.content}),
      ]);
    }}).mount('#editor');
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
        const source = 'const alive = true;' + nl + 'let n = 2;' + nl;
        props.value = {path: 'probe.ts', content: source, editable: true};
        await nextTick();
        await wait(() => text() === source, 'switched content');
        const line = () => document.querySelector('.editor-status-line').textContent;
        await wait(() => line().includes('Строка 1, столбец 1'), 'initial cursor');
        check(line().includes('TypeScript') && /(^|[^A-Z])LF/.test(line()), 'language and line ending');
        view().dispatch({selection: {anchor: view().state.doc.line(2).from + 4}});
        await wait(() => line().includes('Строка 2, столбец 5'), 'cursor follows selection');
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
    skip: !chromium,
    timeout: 90000,
    retry: 2,
  },
  async () => {
    const pages = {
      "/__file_test": filePage,
      "/__diff_edit_test": diffEditPage,
      "/__gutter_test": gutterPage,
    };
    const fixture = await createBrowserFixture({
      pages,
      responses: [
        {
          startsWith: "/api/ide/",
          type: "application/json",
          body: JSON.stringify({ theme: "projector" }),
        },
        {
          startsWith: "/api/projects/",
          includes: "/workspace/gutter",
          type: "application/json",
          body: JSON.stringify({
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
        },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    const dump = (path) => browser.result(fixture.url(path));
    for (const path of Object.keys(pages)) {
      expect(await dump(path), path).toBe("PASS");
    }
    // One editor smoke check exercises module loading after restart; diff cases ran above.
    await fixture.restart();
    expect(await dump("/__file_test"), "editor after restart").toBe("PASS");
  },
);
