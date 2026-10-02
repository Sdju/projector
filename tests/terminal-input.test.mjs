import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const chromium =
  process.env.CHROMIUM_BIN ??
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);

test(
  "xterm in Chromium: late IME translation, text, controls and composition",
  {
    skip: chromium ? false : "Set CHROMIUM_BIN to run the browser input regression",
  },
  async (t) => {
    const profile = await mkdtemp(join(tmpdir(), "projector-input-browser-"));
    const keyboard = ts.transpileModule(
      await readFile(new URL("../src/modules/terminal/lib/keyboard.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const xterm = await readFile(
      new URL("../node_modules/@xterm/xterm/lib/xterm.js", import.meta.url),
    );
    const html = `<!doctype html><div id="terminal"></div><pre id="result">WAITING</pre>
    <script src="/xterm.js"></script><script type="module">
    import { deferTerminalText } from '/keyboard.js';
    try {
      const term = new Terminal();
      term.open(document.getElementById('terminal'));
      term.focus();
      term.attachCustomKeyEventHandler(event => !deferTerminalText(event));
      const input = document.querySelector('.xterm-helper-textarea');
      let sent = '';
      term.onData(data => sent += data);
      const check = (expected, label) => {
        if (sent !== expected) throw new Error(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(sent));
        sent = '';
      };
      const key = (physical, translated, code, keyCode, modifiers = {}) => {
        const props = {key: physical, code, keyCode, which: keyCode, bubbles: true, cancelable: true, ...modifiers};
        // A canceled keydown suppresses the browser's translated keypress.
        if (input.dispatchEvent(new KeyboardEvent('keydown', props)) && translated) {
          const charCode = translated.charCodeAt(0);
          input.dispatchEvent(new KeyboardEvent('keypress', {...props, key: translated, keyCode: charCode, which: charCode, charCode}));
          input.dispatchEvent(new InputEvent('input', {data: translated, inputType: 'insertText', bubbles: true, composed: true}));
        }
        input.dispatchEvent(new KeyboardEvent('keyup', props));
      };
      for (const [physical, translated, code, keyCode] of [
        ['g', 'п', 'KeyG', 71], ['h', 'р', 'KeyH', 72], ['b', 'и', 'KeyB', 66],
        ['d', 'в', 'KeyD', 68], ['t', 'е', 'KeyT', 84], ['n', 'т', 'KeyN', 78],
      ]) key(physical, translated, code, keyCode);
      check('привет', 'Fcitx lowercase virtual layout');
      key('G', 'П', 'KeyG', 71, {shiftKey: true});
      check('П', 'uppercase');
      for (const char of 'abc 123!') key(char, char, '', char.toUpperCase().charCodeAt(0));
      check('abc 123!', 'English and punctuation, without input duplicates');
      key('c', null, 'KeyC', 67, {ctrlKey: true}); check('\\x03', 'Ctrl+C');
      key('Enter', null, 'Enter', 13); check('\\r', 'Enter');
      key('Backspace', null, 'Backspace', 8); check('\\x7f', 'Backspace');
      key('ArrowLeft', null, 'ArrowLeft', 37); check('\\x1b[D', 'ArrowLeft');
      key('a', null, 'KeyA', 65, {altKey: true}); check('\\x1ba', 'Alt+A');
      key('Tab', null, 'Tab', 9); check('\\t', 'Tab');
      input.dispatchEvent(new InputEvent('input', {data: '🙂', inputType: 'insertText', bubbles: true, composed: true}));
      check('🙂', 'input-only text');
      input.value = '';
      input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
      key('Process', null, '', 229, {isComposing: true});
      input.dispatchEvent(new CompositionEvent('compositionupdate', {data: '你好', bubbles: true}));
      input.value = '你好';
      await new Promise(resolve => setTimeout(resolve, 10));
      input.dispatchEvent(new CompositionEvent('compositionend', {data: '你好', bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 10));
      check('你好', 'Chinese composition');
      term.dispose();
      document.getElementById('result').textContent = 'PASS';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
    </script>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
      );
      res.end(req.url === "/xterm.js" ? xterm : req.url === "/keyboard.js" ? keyboard : html);
    });
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(profile, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { stdout } = await promisify(execFile)(
      chromium,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profile}`,
        "--virtual-time-budget=2000",
        "--dump-dom",
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1], "PASS");
  },
);
