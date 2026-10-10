import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { HttpError } from "../http/index.ts";

/** Images pasted or dropped into the chat: kept on disk, referenced from messages by id. */
const TYPES: Record<string, { ext: string; magic: (head: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (head) => head.subarray(1, 4).toString() === "PNG" },
  "image/jpeg": { ext: "jpg", magic: (head) => head[0] === 0xff && head[1] === 0xd8 },
  "image/gif": { ext: "gif", magic: (head) => head.subarray(0, 3).toString() === "GIF" },
  "image/webp": {
    ext: "webp",
    magic: (head) =>
      head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP",
  },
};
const MAX_BYTES = 10 * 1024 * 1024;
const ID = /^[0-9a-f]{16}$/;
/** Unused attachments of old chats are removed after this long. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const directory = () => join(dataDir(), "agent", "attachments");

export async function saveAttachment(req: IncomingMessage, mime: string, name: string) {
  const type = TYPES[mime];
  if (!type) throw new HttpError(415, "Поддерживаются PNG, JPEG, GIF и WebP");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new HttpError(413, "Изображение больше 10 МБ");
    chunks.push(chunk as Buffer);
  }
  const content = Buffer.concat(chunks);
  if (!content.length || !type.magic(content)) throw new HttpError(400, "Это не изображение");
  const id = randomBytes(8).toString("hex");
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const path = join(directory(), `${id}.${type.ext}`);
  await writeFile(`${path}.tmp`, content, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  void pruneAttachments().catch(() => {});
  return { id, mime, name: name.slice(0, 200) || `image.${type.ext}` };
}

/** The stored image, or `null` when the id is unknown or was removed. */
export async function readAttachment(id: string) {
  if (!ID.test(id)) return null;
  for (const [mime, { ext }] of Object.entries(TYPES)) {
    try {
      return { mime, content: await readFile(join(directory(), `${id}.${ext}`)) };
    } catch {
      // Not stored under this type.
    }
  }
  return null;
}

async function pruneAttachments() {
  const now = Date.now();
  for (const file of await readdir(directory())) {
    const path = join(directory(), file);
    if (now - (await stat(path)).mtimeMs > KEEP_MS) await rm(path, { force: true });
  }
}
