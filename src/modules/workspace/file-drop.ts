import { MAX_TEXT_BYTES, type FileContent } from "../../../core/modules/workspace/index.ts";

export function projectRelativePath(root: string, path: string): string | undefined {
  const prefix = root.replace(/\/+$/, "") + "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}
export async function previewBrowserFile(file: File): Promise<FileContent & { image?: string }> {
  const image = /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name);
  if (image && file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 МБ");
  if (!image && file.size > MAX_TEXT_BYTES)
    throw new Error(
      `Файл больше ${MAX_TEXT_BYTES / 1024 / 1024} МБ: редактор не сможет его открыть`,
    );
  if (image) return { path: file.name, content: "", image: URL.createObjectURL(file) };
  const content = await file.text();
  if (content.includes("\0")) throw new Error("Бинарный файл — просмотр текста недоступен");
  return { path: file.name, content };
}
