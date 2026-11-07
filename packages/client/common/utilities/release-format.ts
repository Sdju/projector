import { countRu } from "./plural.ts";

/** Bytes as `8 Б`, `1,2 КБ`, `3,4 МБ`; null means the host did not report a size. */
export function sizeLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${Math.round(value)} Б`;
  if (value < 1024 * 1024)
    return `${(value / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${(value / 1024 / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`;
}

/** Download count with a Russian noun; null means the host does not report it. */
export function downloadsLabel(value: number | null): string {
  return value === null ? "" : countRu(value, "скачивание", "скачивания", "скачиваний");
}
