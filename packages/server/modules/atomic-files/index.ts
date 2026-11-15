import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";

export interface AtomicWriteOptions {
  /** Permissions of the new file; the default keeps private settings readable by the owner only. */
  mode?: number;
  /** Flush the bytes to disk before the rename; only a throwaway cache may skip it. */
  sync?: boolean;
  /** Закрыть файл для остальных пользователей ОС: на POSIX это chmod, на Windows — ACL. */
  ownerOnly?: boolean;
}

/** Written in full and flushed to disk before the rename replaces the previous file. */
export async function writeFileAtomic(
  file: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "w", options.mode ?? 0o600);
    try {
      await handle.writeFile(text, "utf8");
      if (options.sync !== false) await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  if (options.ownerOnly) await os.tools.restrictToOwner(file);
}

/**
 * Moves a damaged file out of the way so that defaults written next never overwrite it. Два
 * повреждения подряд не должны попасть в одну копию, поэтому к времени добавлен суффикс.
 *
 * A copy that cannot be made is a real error: the caller must not report the file as saved and
 * then let the next write replace it. `undefined` means the file was already gone, so there was
 * nothing to preserve and nothing left to overwrite.
 */
export async function setAsideBroken(file: string): Promise<string | undefined> {
  const backup = `${file}.broken-${Date.now()}-${randomUUID().slice(0, 8)}`;
  try {
    await rename(file, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return backup;
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Runs tasks that touch one file strictly one after another. A failed task never blocks the next
 * one, so a rejected write cannot wedge the file forever.
 */
export function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(file);
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.finally(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
