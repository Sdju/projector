import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { dataDir } from "@projector/core/modules/app-paths/index.ts";
import { HttpError } from "../http/index.ts";

/** Pictures pasted or dropped into the chat, served inline; anything else is just stored. */
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
/** Files of any type may be attached; pictures also have to be what their header says. */
const MAX_BYTES = 10 * 1024 * 1024;
const ID = /^[0-9a-f]{16}$/;
/** Unused attachments of old chats are removed after this long. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const directory = () => join(dataDir(), "agent", "attachments");

/** A name that stays readable in a chip and is safe on every platform. */
function safeName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 100);
  return clean || "file";
}

async function store(path: string, content: Buffer) {
  await writeFile(`${path}.tmp`, content, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export async function saveAttachment(req: IncomingMessage, mime: string, name: string) {
  const type = TYPES[mime.trim().toLowerCase()];
  const keptName = safeName(name);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new HttpError(413, "Файл больше 10 МБ");
    chunks.push(chunk as Buffer);
  }
  const content = Buffer.concat(chunks);
  if (!content.length) throw new HttpError(400, "Пустой файл");
  const id = randomBytes(8).toString("hex");
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  if (type) {
    if (!type.magic(content)) throw new HttpError(400, "Это не изображение");
    const path = join(directory(), `${id}.${type.ext}`);
    await store(path, content);
    void pruneAttachments().catch(() => {});
    return { id, mime: mime.trim().toLowerCase(), name: keptName, path };
  }
  // A file of any type is kept in its own folder and opened from disk, so the chat holds a
  // normal path the agent can read instead of a copy inside the project.
  const path = join(directory(), id, keptName);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await store(path, content);
  void pruneAttachments().catch(() => {});
  return { id, mime: "application/octet-stream", name: keptName, path };
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
    if (now - (await stat(path)).mtimeMs > KEEP_MS)
      await rm(path, { recursive: true, force: true });
  }
}
