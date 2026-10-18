import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** Written in full and flushed to disk before the rename replaces the previous file. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Moves a damaged file out of the way so that defaults written next never overwrite it. */
export async function setAsideBroken(file: string): Promise<string> {
  const backup = `${file}.broken-${Date.now()}`;
  await rename(file, backup).catch(() => {});
  return backup;
}
