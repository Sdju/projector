import type { FileEntry } from "./contract.ts";

export const TREE_PAGE_SIZE = 30;
export interface TreePage {
  entries: FileEntry[];
  truncated: boolean;
  total: number;
  nextOffset: number | null;
}

/** Apply the same sorted-directory paging contract to local and remote providers. */
export function treePageRange<T extends { name: string }>(
  entries: readonly T[],
  path: string,
  params: Record<string, string> = {},
) {
  const integer = (key: string, fallback: number, minimum: number, maximum: number) => {
    if (params[key] === undefined) return fallback;
    const value = Number(params[key]);
    if (
      !/^\d+$/.test(params[key]!) ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    )
      throw new Error(`Неверный параметр ${key}`);
    return value;
  };
  const offset = integer("offset", 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = integer("limit", 1000, 1, 1000);
  let end = Math.min(entries.length, offset + limit);
  // Explicit reveal may open several portions, preserving all preceding siblings.
  if (params.reveal && offset === 0) {
    const index = entries.findIndex(
      (entry) => (path ? `${path}/` : "") + entry.name === params.reveal,
    );
    if (index >= 0)
      end = Math.min(
        entries.length,
        Math.max(end, Math.ceil((index + 1) / TREE_PAGE_SIZE) * TREE_PAGE_SIZE),
      );
  }
  return { offset, end, total: entries.length, nextOffset: end < entries.length ? end : null };
}
