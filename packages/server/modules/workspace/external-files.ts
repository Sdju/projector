import { realpath } from "node:fs/promises";
import { isAbsolute, dirname, basename } from "node:path";
import { trimDriveSlash } from "@ai-projector/core/modules/workspace/index.ts";
import { HttpError } from "../http/index.ts";
import { previewProjectFile, readProjectImage } from "./files.ts";

async function externalLocation(value: string) {
  const path = trimDriveSlash(value);
  if (!isAbsolute(path) || path.includes("\0"))
    throw new HttpError(400, "Укажите абсолютный путь к файлу");
  const resolved = await realpath(path);
  return { path, root: dirname(resolved), name: basename(resolved) };
}
export async function previewExternalFile(value: string, options: { ask?: boolean } = {}) {
  const { path, root, name } = await externalLocation(value);
  if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(name)) {
    await readProjectImage(root, name);
    return { path, content: "", image: true };
  }
  return { ...(await previewProjectFile(root, name, options)), path };
}
export async function readExternalImage(value: string) {
  const { root, name } = await externalLocation(value);
  return readProjectImage(root, name);
}
