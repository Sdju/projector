import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Files under a root, recursively, limited in depth so a stray home directory cannot turn a
 * journal scan into a full disk walk. Missing directories are simply empty.
 */
export async function walkFiles(
  root: string,
  accept: (name: string) => boolean,
  maxDepth = 8,
): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && accept(entry.name)) found.push(path);
    }
  }
  await visit(root, 0);
  return found;
}
