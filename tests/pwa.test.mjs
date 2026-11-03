import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { pwaServiceWorkerAction } from "../packages/client/modules/pwa/environment.ts";
import { serveStatic } from "../packages/server/app/static.ts";

const root = fileURLToPath(new URL("../public", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));

test("service worker runs in prod only and is removed from dev and insecure origins", () => {
  const base = { production: true, secure: true, serviceWorker: true };
  expect(pwaServiceWorkerAction(base)).toBe("register");
  expect(pwaServiceWorkerAction({ ...base, production: false })).toBe("unregister");
  expect(pwaServiceWorkerAction({ ...base, secure: false })).toBe("unregister");
  expect(pwaServiceWorkerAction({ ...base, serviceWorker: false })).toBe("none");
  // A stale worker must be removed even when the browser cannot register a new one.
  expect(pwaServiceWorkerAction({ production: false, secure: false, serviceWorker: true })).toBe(
    "unregister",
  );
});

test("manifest is installable, points at existing icons and is linked from the shell", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.webmanifest`, "utf8"));
  expect(manifest.name).toBe("Projector");
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  const purposes = manifest.icons.map((icon) => icon.purpose);
  expect(purposes).toContain("any");
  expect(purposes).toContain("maskable");
  const sizes = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) {
    const file = `${root}${icon.src}`;
    expect((await stat(file)).isFile()).toBe(true);
    const [width, height] = await pngSize(file);
    expect(`${width}x${height}`).toBe(icon.sizes);
  }
  const html = await readFile(`${repo}/index.html`, "utf8");
  expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  expect(html).toContain('rel="apple-touch-icon"');
  expect(html).toContain('name="theme-color"');
});

test("shell worker keeps API and dev traffic out of its fetch handler", async () => {
  const worker = await readFile(`${root}/sw.js`, "utf8");
  expect(worker).toContain('url.pathname.startsWith("/api/")');
  expect(worker).toContain('url.pathname.startsWith("/packages/")');
  expect(worker).toContain('request.mode === "navigate"');
  expect(worker).not.toContain("cache.put");
  expect(worker).not.toContain("cache.add");
});

test("static server sends manifest and worker with the right types and no caching", async () => {
  const server = createServer((req, res) => void serveStatic(root, req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const manifest = await fetch(`${origin}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    expect(manifest.headers.get("cache-control")).toBe("no-cache");

    const worker = await fetch(`${origin}/sw.js`);
    expect(worker.status).toBe(200);
    expect(worker.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(worker.headers.get("cache-control")).toBe("no-cache");

    const icon = await fetch(`${origin}/icons/icon-192.png`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function pngSize(file) {
  const buffer = await readFile(file);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}
