import { expect, onTestFinished, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const reviewPage = `<!doctype html>
<div id="app" style="height:640px"></div>
<pre id="result">WAITING</pre>
<script type="module">
  import '/packages/client/app/styles.css';
  import { createApp, h, nextTick, provide, ref } from 'vue';
  import { provideEditorStatus } from '/packages/client/modules/workspace/modules/viewers/lib/editor-status.ts';
  import { provideEditorTopbar } from '/packages/client/modules/workspace/modules/viewers/lib/editor-topbar.ts';
  import CodeViewer from '/packages/client/modules/workspace/modules/viewers/ui/CodeViewer.vue';
  import { ReviewTab, createReviewSession, reviewSessionKey } from '/packages/client/modules/workspace/modules/review/index.ts';

  const wait = async (condition, label) => {
    const until = Date.now() + 6000;
    while (!condition()) {
      if (Date.now() > until) throw new Error('Timed out: ' + label);
      await fetch('/__tick');
    }
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); };

  const session = createReviewSession();
  const openedTab = ref(false);
  const topbarEl = ref(null);
  const original = 'const a = 1;\\nconst b = 2;\\nconst c = 3;\\n';
  const content = 'const a = 1;\\nconst b = 42;\\nconst c = 3;\\n';

  createApp({
    setup() {
      provideEditorStatus();
      const target = provideEditorTopbar();
      provide(reviewSessionKey, {
        ...session,
        open: () => { openedTab.value = true; },
      });
      const run = (id, args) => {
        if (id === 'ide.review.comment.update') return session.update(args.id, args.text);
        if (id === 'ide.review.comment.remove') return session.remove(args.id);
        if (id === 'ide.review.clear') return session.clear();
      };
      return () => h('div', { style: 'display:flex;flex-direction:column;height:640px' }, [
        h('div', {
          class: 'probe-topbar',
          ref: (el) => { topbarEl.value = el; target.value = el; },
        }),
        h('div', { style: 'height:320px;display:flex;flex-direction:column' }, [
          h(CodeViewer, {
            path: 'src/demo.ts',
            projectId: 'p1',
            original,
            content,
            editable: false,
            staged: false,
          }),
        ]),
        h('div', { style: 'height:300px;overflow:auto' }, [
          h(ReviewTab, { projectId: 'p1', run }),
        ]),
      ]);
    },
  }).mount('#app');

  (async () => {
    try {
      await wait(() => document.querySelector('.cm-review-gutter .cm-gutterElement'), 'review gutter');
      // 1. Click gutter on line 2 -> inline composer opens immediately without any toggle mode
      const gutterLines = document.querySelectorAll('.cm-review-gutter .cm-gutterElement');
      check(gutterLines.length >= 3, 'gutter lines rendered');
      gutterLines[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      await wait(() => document.querySelector('.cm-review-composer textarea'), 'inline composer');
      check(document.querySelector('.cm-review-line-composing') !== null, 'composing line highlighted');

      // 2. Type text and submit with Ctrl+Enter
      const textarea = document.querySelector('.cm-review-composer textarea');
      textarea.value = 'Проверить константу';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));

      await wait(() => document.querySelector('.cm-review-card:not(.cm-review-composer)'), 'inline remark card');
      check(document.querySelector('.cm-review-card .cm-review-text').textContent === 'Проверить константу', 'inline text');
      check(document.querySelector('.cm-review-marker') !== null, 'gutter marker');
      check(document.querySelector('.probe-topbar .review-topbar-btn')?.textContent?.trim() === '1', 'topbar counter');

      // 3. ReviewTab shows grouped file with directory, snippet, and no nested buttons
      await wait(() => document.querySelector('.review-tab .file-group'), 'review tab group');
      check(document.querySelector('.review-tab .file-name').textContent === 'demo.ts', 'file name');
      check(document.querySelector('.review-tab .file-dir').textContent === 'src', 'file dir');
      check(document.querySelector('.review-tab .snippet-code').textContent.includes('const b = 42'), 'code snippet captured');
      check(document.querySelector('.review-tab button button') === null, 'no nested buttons');

      // 4. Inline edit in CodeViewer
      document.querySelector('.cm-review-card button[data-command="ide.review.comment.update"]').click();
      await wait(() => document.querySelector('.cm-review-composer textarea'), 'inline edit composer');
      const editArea = document.querySelector('.cm-review-composer textarea');
      check(editArea.value === 'Проверить константу', 'edit prefilled');
      editArea.value = 'Уточнённое замечание';
      editArea.dispatchEvent(new Event('input', { bubbles: true }));
      editArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      await wait(
        () => document.querySelector('.cm-review-card .cm-review-text')?.textContent === 'Уточнённое замечание',
        'inline edit saved',
      );

      // 5. Side-by-side mode keeps review gutter & cards only on the modified pane (right)
      document.querySelector('.diff-layout button[title="Две колонки"]').click();
      await wait(() => document.querySelectorAll('.cm-mergeView .cm-editor').length === 2, 'side-by-side');
      await nextTick();
      const [leftPane, rightPane] = document.querySelectorAll('.cm-mergeView .cm-editor');
      check(leftPane.querySelector('.cm-review-gutter') === null, 'no review gutter on original pane');
      check(leftPane.querySelector('.cm-review-card') === null, 'no review card on original pane');
      check(rightPane.querySelector('.cm-review-gutter') !== null, 'review gutter on modified pane');
      check(rightPane.querySelector('.cm-review-card') !== null, 'review card on modified pane');

      // 6. Delete from inline card clears everything
      rightPane.querySelector('button[data-command="ide.review.comment.remove"]').click();
      await wait(() => !document.querySelector('.cm-review-card'), 'remark removed');
      await wait(() => document.querySelector('.review-tab .empty') !== null, 'empty state in tab');

      document.getElementById('result').textContent = 'PASS';
    } catch (error) {
      document.getElementById('result').textContent = 'FAIL: ' + (error?.stack || error);
    }
  })();
</script>`;

test.skipIf(!chromium)(
  "inline review workflow works in CodeViewer and ReviewTab in Chromium",
  { timeout: 30_000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__review_test": reviewPage },
      routes: [
        {
          match: "/api/editor-themes",
          type: "application/json",
          body: JSON.stringify({ themes: [] }),
        },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    expect(await browser.result(fixture.url("/__review_test"))).toBe("PASS");
  },
);
