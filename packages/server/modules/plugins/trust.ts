import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * A content hash of the package: paths, sizes and bytes, sorted by path. It is the value the user
 * confirms before an agent plugin may run, so a changed package needs a new confirmation.
 */
export async function hashPackage(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink())
        throw new Error("Символические ссылки в плагине не поддерживаются");
      if (entry.isDirectory()) {
        await walk(path, `${relative}/`);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await lstat(path);
      hash.update(`${relative}\0${info.size}\0`);
      for await (const chunk of createReadStream(path)) hash.update(chunk);
    }
  }
  await walk(root, "");
  return hash.digest("hex");
}

/** Whether the stored confirmation still describes the package on disk. */
export function isTrusted(stored: string | undefined, current: string | undefined): boolean {
  return !!stored && !!current && stored === current;
}
