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
  "xterm in Chromium: IME, Unicode, controls, mouse protocols and selection",
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
    const css = await readFile(new URL("../node_modules/@xterm/xterm/css/xterm.css", import.meta.url), "utf8");
    const forwarding = ts.transpileModule(
      await readFile(new URL("../src/modules/terminal/lib/input.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const html = `<!doctype html><style>${css}</style><div id="terminal"></div><pre id="result">WAITING</pre>
    <script src="/xterm.js"></script><script type="module">
    import { deferTerminalText } from '/keyboard.js';
    import { bindTerminalInput } from '/forwarding.js';
    try {
      const term = new Terminal({cols: 160});
      term.open(document.getElementById('terminal'));
      term.focus();
      term.attachCustomKeyEventHandler(event => !deferTerminalText(event));
      const input = document.querySelector('.xterm-helper-textarea');
      let sent = '';
      const frames = [];
      bindTerminalInput(term, message => {
        frames.push(message);
        if (!message.encoding) sent += message.data;
      }, () => true);
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
      const write = data => new Promise(resolve => term.write(data, resolve));
      await new Promise(resolve => setTimeout(resolve, 30));
      const screen = term.element.querySelector('.xterm-screen');
      const rect = screen.getBoundingClientRect();
      const point = {clientX: rect.left + rect.width / term.cols * 110.5,
        clientY: rect.top + rect.height / term.rows * 10.5, bubbles: true, cancelable: true};
      const click = () => {
        screen.dispatchEvent(new MouseEvent('mousedown', {...point, button: 0, buttons: 1}));
        document.dispatchEvent(new MouseEvent('mouseup', {...point, button: 0, buttons: 0}));
      };
      await write('\\x1b[?1000h');
      frames.length = 0; click();
      screen.dispatchEvent(new WheelEvent('wheel', {...point, deltaY: 120, deltaMode: 0}));
      if (frames.length < 3 || frames.some(f => f.encoding !== 'binary')) throw new Error('legacy mouse channel: ' + JSON.stringify(frames));
      if (!frames.some(f => [...f.data].some(c => c.charCodeAt(0) > 127))) throw new Error('legacy high coordinate byte missing');
      await write('\\x1b[?1006h');
      frames.length = 0; click();
      screen.dispatchEvent(new WheelEvent('wheel', {...point, deltaY: -120, deltaMode: 0}));
      if (!frames.some(f => f.data === '\\x1b[<0;111;11M') || !frames.some(f => f.data === '\\x1b[<0;111;11m') || !frames.some(f => f.data.startsWith('\\x1b[<64;'))) throw new Error('SGR mouse: ' + JSON.stringify(frames));
      sent = '';
      key('g', 'п', 'KeyG', 71); check('п', 'Russian with mouse tracking');
      frames.length = 0;
      screen.dispatchEvent(new MouseEvent('mousedown', {...point, button: 0, buttons: 1, shiftKey: true}));
      document.dispatchEvent(new MouseEvent('mouseup', {...point, button: 0, buttons: 0, shiftKey: true}));
      if (frames.length) throw new Error('Shift selection must not send mouse input');
      await write('\\x1b[?1000l\\x1b[?1006l');
      frames.length = 0;
      screen.dispatchEvent(new WheelEvent('wheel', {...point, deltaY: 120, deltaMode: 0}));
      if (frames.length) throw new Error('shell scrollback must not send mouse input');
      sent = ''; frames.length = 0;
      term.paste('привет🙂'); check('привет🙂', 'Unicode paste after mouse');
      sent = ''; frames.length = 0;
      term.paste('a'.repeat(8191) + '🙂привет');
      if (frames.length !== 2 || frames[0].data.length !== 8191 || frames[1].data !== '🙂привет') throw new Error('split Unicode paste');
      term.dispose();
      document.getElementById('result').textContent = 'PASS';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
    </script>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
      );
      res.end(req.url === "/xterm.js" ? xterm : req.url === "/keyboard.js" ? keyboard : req.url === "/forwarding.js" ? forwarding : html);
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
