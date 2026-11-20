import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { HttpError } from "../http/index.ts";
import { writeFileAtomic } from "../atomic-files/index.ts";

const limit = 12 * 1024 * 1024;
const directory = () => join(dataDir(), "appearance");
const imagePath = () => join(directory(), "wallpaper");
const metadataPath = () => join(directory(), "wallpaper.json");
const types = new Map([
  ["image/avif", "image/avif"],
  ["image/gif", "image/gif"],
  ["image/jpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"],
]);

export async function saveWallpaper(
  body: AsyncIterable<Uint8Array>,
  contentType: string | undefined,
) {
  const mime = types.get(contentType?.split(";", 1)[0].trim().toLowerCase() ?? "");
  if (!mime) throw new HttpError(400, "Выберите изображение PNG, JPEG, WebP, AVIF или GIF");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new HttpError(413, "Изображение должно быть не больше 12 МБ");
    chunks.push(bytes);
  }
  if (!size) throw new HttpError(400, "Выбранный файл пуст");
  await mkdir(directory(), { recursive: true });
  const temporary = `${imagePath()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, Buffer.concat(chunks), { mode: 0o600 });
    await rename(temporary, imagePath());
    await writeFileAtomic(metadataPath(), JSON.stringify({ mime }));
  } finally {
    await rm(temporary, { force: true });
  }
  return { url: "/api/appearance/wallpaper" };
}

export async function importWallpaper(url: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "image/avif,image/gif,image/jpeg,image/png,image/webp" },
    });
  } catch {
    throw new HttpError(400, "Не удалось скачать изображение по ссылке");
  }
  if (!response.ok || !response.body)
    throw new HttpError(400, `Не удалось скачать изображение: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > limit) throw new HttpError(413, "Изображение должно быть не больше 12 МБ");
  return saveWallpaper(response.body, response.headers.get("content-type") ?? undefined);
}

export async function sendWallpaper(res: ServerResponse) {
  let mime: string;
  try {
    const metadata = JSON.parse(await readFile(metadataPath(), "utf8"));
    mime = types.get(metadata.mime) ?? "";
    if (!mime) throw new Error("Unsupported wallpaper");
  } catch {
    throw new HttpError(404, "Фоновое изображение не найдено");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  const stream = createReadStream(imagePath());
  stream.on("error", () => {
    if (!res.headersSent) res.statusCode = 404;
    res.destroy();
  });
  stream.pipe(res);
}
