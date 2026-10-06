import { createReadStream, type ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "../http/index.ts";
import { location } from "./paths.ts";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xhtml: "application/xhtml+xml; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
  pdf: "application/pdf",
};

export interface SiteFile {
  type: string;
  size: number;
  stream: ReadStream;
}

/**
 * Файл проекта для просмотра как части сайта. Каталог без завершающего `/` возвращает
 * `redirect`: относительные ссылки документа резолвятся от адреса со слэшем.
 */
export async function openProjectSiteFile(
  root: string,
  path: string,
): Promise<SiteFile | { redirect: true }> {
  if (path.split("/").includes(".git")) throw new HttpError(403, "Каталог .git недоступен");
  let full = await location(root, path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(404, "Файл не найден");
    throw error;
  });
  let info = await stat(full);
  if (info.isDirectory()) {
    if (path && !path.endsWith("/")) return { redirect: true };
    full = await location(root, join(path, "index.html")).catch(() => {
      throw new HttpError(404, "В каталоге нет index.html");
    });
    info = await stat(full);
  }
  if (!info.isFile()) throw new HttpError(400, "Выберите файл");
  const type = TYPES[full.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";
  return { type, size: info.size, stream: createReadStream(full) };
}
