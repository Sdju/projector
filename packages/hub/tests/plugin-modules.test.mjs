import { expect, test } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHub } from "../modules/gateway/index.ts";
import { connectHub } from "../../server/modules/hub/connector.ts";
import { accessAllowed, isLocalRequest } from "../../server/modules/access/index.ts";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

// Exercise the browser's module loader through real reverse tunnels. Replacing fetch with a
// mock would miss both cookie authentication and relative imports bypassing deviceUrl().
test(
  "Hub loads device-owned ESM entries, relative chunks and assets without mixing devices",
  { skip: !chromium, timeout: 60000 },
  async ({ onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), "projector-hub-plugin-modules-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const reserve = createServer();
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const origin = `http://localhost:${port}`;
    const hash = "a".repeat(64);
    const modulePath = `/plugins/assets/example/${hash}/dist/entry.js`;
    const page = `<!doctype html><pre id="result">WAITING</pre><script type="module">
      const check = (value, label) => { if (!value) throw new Error(label); };
      try {
        const login = await fetch('/api/hub/session', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({password: 'browser-secret'})
        });
        check(login.ok, 'browser login');
        const a = await import('/api/devices/desk${modulePath}');
        const b = await import('/api/devices/laptop${modulePath}');
        check(a.device === 'desk' && b.device === 'laptop', 'relative chunks stay device scoped');
        check(await fetch(a.asset).then(r => r.text()) === 'desk asset', 'desk asset');
        check(await fetch(b.asset).then(r => r.text()) === 'laptop asset', 'laptop asset');
        check(a.asset.includes('/api/devices/desk/') && b.asset.includes('/api/devices/laptop/'), 'asset URLs');
        document.querySelector('#result').textContent = 'PASS';
      } catch (error) { document.querySelector('#result').textContent = 'FAIL: ' + error.stack; }
    </script>`;
    await writeFile(join(root, "hub.html"), page);
    await writeFile(join(root, "index.html"), page);
    const hub = createHub({
      origin,
      password: "browser-secret",
      deviceToken: "device-secret",
      staticRoot: root,
      dataDir: root,
    });
    await new Promise((resolve) => hub.server.listen(port, "127.0.0.1", resolve));
    onTestFinished(() => hub.close());
    const requests = [];
    for (const device of ["desk", "laptop"]) {
      let ready;
      const connected = new Promise((resolve) => (ready = resolve));
      const stop = connectHub(
        { url: origin, deviceId: device, token: "device-secret" },
        {
          handle(req, res) {
            requests.push({
              device,
              path: req.url,
              local: isLocalRequest(req),
              cookie: req.headers.cookie,
            });
            if (!accessAllowed(req, false)) return void res.writeHead(403).end();
            const path = `/api${modulePath}`;
            const chunks = {
              [path]: `import {device} from './chunk.js'; export {device}; export const asset = new URL('./label.txt', import.meta.url).href;`,
              [path.replace("entry.js", "chunk.js")]:
                `export const device = ${JSON.stringify(device)};`,
            };
            if (chunks[req.url]) {
              res.writeHead(200, {
                "Content-Type": "text/javascript",
                "X-Content-Type-Options": "nosniff",
              });
              res.end(chunks[req.url]);
            } else if (req.url === path.replace("entry.js", "label.txt")) {
              res.writeHead(200, { "Content-Type": "text/plain" });
              res.end(`${device} asset`);
            } else res.writeHead(404).end();
          },
          attach() {
            return () => {};
          },
        },
        (online) => {
          if (online) ready();
        },
      );
      onTestFinished(stop);
      await connected;
    }
    expect((await fetch(`${origin}/api/devices/desk${modulePath}`)).status).toBe(401);
    const browser = await createChromium(root);
    onTestFinished(() => browser.close());
    expect(await browser.result(`${origin}/login`)).toBe("PASS");
    expect(requests).toHaveLength(6);
    expect(requests.every((request) => !request.local && !request.cookie)).toBe(true);
    for (const device of ["desk", "laptop"])
      expect(
        requests
          .filter((request) => request.device === device)
          .map((request) => request.path)
          .sort(),
      ).toEqual(
        ["chunk.js", "entry.js", "label.txt"]
          .map((file) => `/api${modulePath}`.replace("entry.js", file))
          .sort(),
      );
  },
);
