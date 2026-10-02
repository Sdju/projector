import { realpath } from "node:fs/promises";
import { isAbsolute, dirname, basename } from "node:path";
import { HttpError } from "../http/index.ts";
import { previewProjectFile, readProjectImage } from "./workspace.ts";

async function externalLocation(path: string) {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new HttpError(400, "Укажите абсолютный путь к файлу");
  const resolved = await realpath(path);
  return { root: dirname(resolved), name: basename(resolved) };
}
export async function previewExternalFile(path: string) {
  const { root, name } = await externalLocation(path);
  if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(name)) {
    await readProjectImage(root, name);
    return { path, content: "", image: true };
  }
  return { ...(await previewProjectFile(root, name)), path };
}
export async function readExternalImage(path: string) {
  const { root, name } = await externalLocation(path);
  return readProjectImage(root, name);
}
