import { expect, onTestFinished, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { terminalTextForPaths } from "../src/modules/terminal/lib/drop.ts";
import { terminalLinks } from "../src/modules/terminal/lib/links.ts";
import { resolveTerminalPath } from "../server/modules/terminal/link-files.ts";
import { mkdir, writeFile, symlink } from "node:fs/promises";

test("terminal links parse paths, diagnostic locations, quoted names and URLs", () => {
  const text =
    'src/main.ts:12:3 ./README.md ../file.js(9,2) "/tmp/with spaces.txt":4 `docs/русский.md` https://example.com/a?b=1 /tmp/test.ts, file:///tmp/a%20b.md';
  const links = terminalLinks(text);
  expect(links.map(({ path, line, column, web }) => ({ path, line, column, web }))).toStrictEqual([
    { path: "src/main.ts", line: 12, column: 3, web: undefined },
    { path: "./README.md", line: undefined, column: undefined, web: undefined },
    { path: "../file.js", line: 9, column: 2, web: undefined },
    { path: "/tmp/with spaces.txt", line: 4, column: undefined, web: undefined },
    { path: "docs/русский.md", line: undefined, column: undefined, web: undefined },
    { path: "https://example.com/a?b=1", line: undefined, column: undefined, web: true },
    { path: "/tmp/test.ts", line: undefined, column: undefined, web: undefined },
    { path: "/tmp/a b.md", line: undefined, column: undefined, web: undefined },
  ]);
  expect(text.slice(links[0].start, links[0].end)).toBe("src/main.ts:12:3");
  expect(
    terminalLinks("Dockerfile .env .gitignore main.ts(12, 3)").map((link) => [
      link.path,
      link.line,
      link.column,
    ]),
  ).toStrictEqual([
    ["Dockerfile", undefined, undefined],
    [".env", undefined, undefined],
    [".gitignore", undefined, undefined],
    ["main.ts", 12, 3],
  ]);
  expect(
    terminalLinks("hello 1.2.3 12:30 javascript:alert(1) data:text/plain / //host/path"),
  ).toStrictEqual([]);
});

test("terminal file resolution uses cwd, project fallback and canonical external paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-link-path-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const cwd = join(project, "nested");
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "local.ts"), "local");
  await writeFile(join(project, "README.md"), "readme");
  const outside = join(root, "outside.txt");
  await writeFile(outside, "external");
  await symlink(outside, join(project, "linked.txt"));
  expect(await resolveTerminalPath("local.ts", project, cwd)).toStrictEqual({
    path: "nested/local.ts",
    external: false,
  });
  expect(await resolveTerminalPath("README.md", project, cwd)).toStrictEqual({
    path: "README.md",
    external: false,
  });
  expect(await resolveTerminalPath("../README.md", project, cwd)).toStrictEqual({
    path: "README.md",
    external: false,
  });
  expect(await resolveTerminalPath(outside, project, cwd)).toStrictEqual({
    path: outside,
    external: true,
  });
  expect(await resolveTerminalPath("linked.txt", project, cwd)).toStrictEqual({
    path: outside,
    external: true,
  });
  await expect(resolveTerminalPath("missing.ts", project, cwd)).rejects.toThrow(/не найден/);
  await expect(resolveTerminalPath(cwd, project, cwd)).rejects.toThrow(/не найден/);
  await expect(resolveTerminalPath("bad\0.ts", project, cwd)).rejects.toThrow(/Некорректный/);
});

test("dropped paths survive shell quoting without command execution or Enter", async () => {
  const paths = [
    "/tmp/файл с пробелами",
    "/tmp/a'b",
    "/tmp/$(echo INJECTED);`echo BAD`",
    "/tmp/a\\b",
    "/tmp/line\nnext\r\x1b",
  ];
  const text = terminalTextForPaths(paths);
  expect(!/[\r\n\x1b]/.test(text)).toBeTruthy();
  const { stdout } = await promisify(execFile)("bash", ["-c", `printf '%s\\0' ${text}`]);
  expect(stdout.split("\0").slice(0, -1)).toStrictEqual(paths);
});

const chromium =
  process.env.CHROMIUM_BIN ??
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);

test(
  "xterm in Chromium: IME, Unicode, controls, mouse protocols and selection",
  {
    skip: !chromium,
    retry: 2,
  },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "projector-input-browser-"));
    const keyboard = ts.transpileModule(
      await readFile(new URL("../src/modules/terminal/lib/keyboard.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const xterm = await readFile(
      new URL("../node_modules/@xterm/xterm/lib/xterm.js", import.meta.url),
    );
    const css = await readFile(
      new URL("../node_modules/@xterm/xterm/css/xterm.css", import.meta.url),
      "utf8",
    );
    const forwarding = ts.transpileModule(
      await readFile(new URL("../src/modules/terminal/lib/input.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const links = ts.transpileModule(
      await readFile(new URL("../src/modules/terminal/lib/links.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const dropPaths = ts.transpileModule(
      await readFile(new URL("../src/modules/path-drop/drop-paths.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const drop = ts
      .transpileModule(
        await readFile(new URL("../src/modules/terminal/lib/drop.ts", import.meta.url), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
      )
      .outputText.replace("../../path-drop/index.ts", "/drop-paths.js");
    const html = `<!doctype html><style>${css}</style><div id="terminal"></div><pre id="result">WAITING</pre>
    <script src="/xterm.js"></script><script type="module">
    import { deferTerminalText } from '/keyboard.js';
    import { bindTerminalInput } from '/forwarding.js';
    import { droppedTerminalPaths, terminalTextForPaths } from '/drop.js';
    import { bindTerminalLinks } from '/links.js';
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
      const treeDrop = new DataTransfer();
      treeDrop.setData('application/x-projector-tree-entry', JSON.stringify({projectId:'test-project', path:'README.md'}));
      const treePaths = await droppedTerminalPaths(treeDrop, () => { throw new Error('Unexpected upload'); }, async (projectId, path) => {
        if (projectId !== 'test-project' || path !== 'README.md') throw new Error('Missing tree payload');
        return '/project/' + path;
      });
      if (treePaths[0] !== '/project/README.md') throw new Error('Relative tree path');
      const uriDrop = new DataTransfer();
      uriDrop.setData('text/uri-list', '# comment\\r\\nfile:///tmp/a%20b\\r\\nfile:///tmp/%D1%84%D0%B0%D0%B9%D0%BB');
      const paths = await droppedTerminalPaths(uriDrop, () => { throw new Error('Unexpected upload'); });
      if (JSON.stringify(paths) !== JSON.stringify(['/tmp/a b', '/tmp/файл'])) throw new Error('URI drop paths');
      sent = ''; term.paste(terminalTextForPaths(paths)); check("'/tmp/a b' '/tmp/файл' ", 'dropped paths input');
      const fileDrop = new DataTransfer();
      fileDrop.items.add(new File(['contents'], 'dropped.txt'));
      const uploaded = await droppedTerminalPaths(fileDrop, async file => {
        if (file.name !== 'dropped.txt' || await file.text() !== 'contents') throw new Error('Missing dropped file contents');
        return '/tmp/upload/dropped.txt';
      });
      if (uploaded[0] !== '/tmp/upload/dropped.txt') throw new Error('File-only drop fallback');
      const opened = [];
      const linkBinding = bindTerminalLinks(term, link => opened.push(link));
      await write('\\x1bcsrc/main.ts:12:3 https://example.com/docs\\r\\n');
      const buffer = term.buffer.active;
      const getLine = buffer.getLine.bind(buffer); let reads = 0;
      buffer.getLine = index => { reads++; return getLine(index); };
      const linkRect = screen.getBoundingClientRect();
      const at = col => ({clientX:linkRect.left + linkRect.width/term.cols*(col+0.5),clientY:linkRect.top+linkRect.height/term.rows*0.5,bubbles:true,cancelable:true});
      const tick = () => new Promise(resolve => setTimeout(resolve, 50));
      for (let col=0;col<12;col++) screen.dispatchEvent(new MouseEvent('mousemove',at(col)));
      await tick();
      if(reads) throw new Error('Hover without Ctrl must not read terminal buffer: '+reads);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',ctrlKey:true,bubbles:true}));
      await tick();
      if(!reads || screen.style.cursor!=='pointer') throw new Error('Ctrl pressed over stationary pointer must discover the link');
      // Full-screen CLI mouse reporting must not receive the file navigation click.
      await write('\\x1b[?1000h\\x1b[?1006h'); frames.length=0;
      screen.dispatchEvent(new MouseEvent('mousedown',{...at(5),button:0,buttons:1,ctrlKey:true}));
      screen.dispatchEvent(new MouseEvent('mouseup',{...at(5),button:0,buttons:0,ctrlKey:true}));
      if(frames.length || opened.length!==1 || opened[0].path!=='src/main.ts' || opened[0].line!==12 || opened[0].column!==3) throw new Error('Ctrl+click must open file location without PTY input: '+JSON.stringify({frames,opened}));
      window.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',ctrlKey:false,bubbles:true}));
      const idleReads=reads;
      await write('\\r\\nbackground output'); await tick();
      if(reads!==idleReads || screen.style.cursor==='pointer') throw new Error('Output and Ctrl release must disable scanning and highlight');
      screen.dispatchEvent(new MouseEvent('mousemove',{...at(22),ctrlKey:true})); await tick();
      screen.dispatchEvent(new MouseEvent('mousedown',{...at(22),button:0,buttons:1,ctrlKey:true}));
      screen.dispatchEvent(new MouseEvent('mouseup',{...at(22),button:0,buttons:0,ctrlKey:true}));
      if(opened.length!==2 || !opened[1].web || opened[1].path!=='https://example.com/docs') throw new Error('Ctrl+click must recognize HTTP URLs');
      term.element.dispatchEvent(new MouseEvent('mouseleave')); await tick();
      const leaveReads=reads;
      await write('\\r\\nmore background output'); await tick();
      if(reads!==leaveReads) throw new Error('Leaving xterm must disable scanning');
      // Unicode cells and soft wraps must map character offsets back to screen cells.
      await write('\\x1bc'); term.resize(20,24);
      await write('界🙂 e\\u0301 src/very-long-filename.ts:7:2');
      const wrappedRect=screen.getBoundingClientRect();
      const wrapPoint={clientX:wrappedRect.left+wrappedRect.width/term.cols*3.5,clientY:wrappedRect.top+wrappedRect.height/term.rows*1.5,bubbles:true,cancelable:true,ctrlKey:true};
      screen.dispatchEvent(new MouseEvent('mousemove',wrapPoint)); await tick();
      screen.dispatchEvent(new MouseEvent('mousedown',{...wrapPoint,button:0,buttons:1}));
      screen.dispatchEvent(new MouseEvent('mouseup',{...wrapPoint,button:0,buttons:0}));
      if(opened.at(-1).path!=='src/very-long-filename.ts' || opened.at(-1).line!==7) throw new Error('Wrapped paths after wide/combining characters must open');
      window.dispatchEvent(new Event('blur'));
      const blurReads=reads;
      await write('\\r\\noutput while unfocused'); await tick();
      if(reads!==blurReads || screen.style.cursor==='pointer') throw new Error('Window blur must disable parsing and highlight');
      linkBinding.dispose();
      term.dispose();
      document.getElementById('result').textContent = 'PASS';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
    </script>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
      );
      res.end(
        req.url === "/xterm.js"
          ? xterm
          : req.url === "/keyboard.js"
            ? keyboard
            : req.url === "/forwarding.js"
              ? forwarding
              : req.url === "/links.js"
                ? links
                : req.url === "/drop-paths.js"
                  ? dropPaths
                  : req.url === "/drop.js"
                    ? drop
                    : html,
      );
    });
    onTestFinished(async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(profile, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { stdout, stderr } = await promisify(execFile)(
      chromium,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profile}`,
        "--virtual-time-budget=5000",
        "--dump-dom",
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    expect(
      stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1],
      `Browser input regression failed:\n${stdout.slice(-4000)}\n${stderr.slice(-2000)}`,
    ).toBe("PASS");
  },
);
