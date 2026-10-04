import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { HttpError } from "../http/index.ts";

const MAX_DROP_BYTES = 50 * 1024 * 1024;

export async function saveDroppedFile(
  req: IncomingMessage,
  name: string,
  available: () => boolean,
  retain: (directory: string) => void,
): Promise<string> {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\\x00-\x1f\x7f]/.test(name) ||
    name.length > 255
  )
    throw new HttpError(400, "Некорректное имя файла");
  if (Number(req.headers["content-length"]) > MAX_DROP_BYTES)
    throw new HttpError(413, "Размер файла превышает 50 МБ");
  const directory = await mkdtemp(join(tmpdir(), "projector-drop-"));
  const path = join(directory, name);
  try {
    const file = await open(path, "wx", 0o600);
    try {
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_DROP_BYTES) throw new HttpError(413, "Размер файла превышает 50 МБ");
        if (!available()) throw new HttpError(409, "Терминал больше не принимает файлы");
        await file.writeFile(chunk);
      }
    } finally {
      await file.close();
    }
    if (!available()) throw new HttpError(409, "Терминал больше не принимает файлы");
    retain(directory);
    return path;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
