import { Readable } from "node:stream";
import type { ServerResponse } from "node:http";

/** A safe attachment name: no controls, separators or quotes; long names are cut. */
export function downloadFilename(value: string, fallback = "download"): string {
  let clean = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    clean +=
      code < 0x20 || code === 0x7f || character === "/" || character === "\\" || character === '"'
        ? "_"
        : character;
  }
  clean = Array.from(clean.trim()).slice(0, 180).join("");
  return clean || fallback;
}

/** RFC 5987 disposition: an ASCII fallback plus the exact UTF-8 name. */
export function contentDisposition(value: string, fallback = "download"): string {
  const name = downloadFilename(value, fallback);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function responseType(value: string | null, fallback: string): string {
  const candidate = (value || fallback).split(";")[0]!.trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(candidate) && !/^text\/html$/i.test(candidate)
    ? candidate
    : "application/octet-stream";
}

/**
 * Streams an upstream download to the browser. The body is never buffered, a closed page
 * destroys the upstream stream, and the filename is reduced to a safe attachment header.
 */
export function sendDownload(
  res: ServerResponse,
  response: Response,
  name: string,
  contentType = "application/octet-stream",
): void {
  const length = response.headers.get("content-length");
  res.statusCode = 200;
  res.setHeader("Content-Type", responseType(response.headers.get("content-type"), contentType));
  res.setHeader("Content-Disposition", contentDisposition(name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  if (length && /^\d+$/.test(length)) res.setHeader("Content-Length", length);
  if (!response.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(response.body as never);
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
