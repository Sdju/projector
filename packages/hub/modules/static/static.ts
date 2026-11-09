import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/** Отдаёт файл из `root`; неизвестные пути без расширения уходят в index.html (SPA). */
export async function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
  shell = "index.html",
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const candidate = normalize(join(root, pathname));
  let file = candidate === root || candidate.startsWith(root + sep) ? candidate : "";
  if (!file || !(await isFile(file))) {
    if (extname(pathname)) {
      res.writeHead(404).end();
      return;
    }
    file = join(root, shell);
  }
  if (!(await isFile(file))) {
    res.writeHead(503).end("Сначала выполните vp run build");
    return;
  }
  const immutable = file.startsWith(join(root, "assets") + sep);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else if (file === join(root, "index.html")) {
    const device = /^\/devices\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/.exec(pathname)?.[1];
    const html = await readFile(file, "utf8");
    res.end(
      device
        ? html.replace(
            'src="/api/appearance/bootstrap.js"',
            `src="/api/devices/${device}/appearance/bootstrap.js"`,
          )
        : html,
    );
  } else createReadStream(file).pipe(res);
}
