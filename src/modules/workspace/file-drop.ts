import type { FileContent } from "../../../core/modules/workspace/index.ts";

export function projectRelativePath(root: string, path: string): string | undefined {
  const prefix = root.replace(/\/+$/, "") + "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}
export async function previewBrowserFile(file: File): Promise<FileContent & { image?: string }> {
  const image = /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name);
  const limit = (image ? 8 : 1) * 1024 * 1024;
  if (file.size > limit) throw new Error(`Файл больше ${image ? 8 : 1} МБ`);
  if (image) return { path: file.name, content: "", image: URL.createObjectURL(file) };
  const content = await file.text();
  if (content.includes("\0")) throw new Error("Бинарный файл — просмотр текста недоступен");
  return { path: file.name, content };
}
