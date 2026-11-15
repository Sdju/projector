import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";

/** Решение о доверии к файлу проекта: у каждого вида свои поля, `hash` есть всегда. */
export type TrustRecord = { hash: string } & Record<string, string>;

interface TrustFile<Entry extends TrustRecord> {
  version: 1;
  projects: Record<string, Entry>;
}

export interface TrustStoreShape<Entry extends TrustRecord> {
  /** Файл решений в приватном каталоге данных. */
  file: () => string;
  /** Обязательные строковые поля записи: всё остальное в файле отбрасывается. */
  fields: readonly (keyof Entry & string)[];
  /** Дополнительная проверка разобранной записи, например допустимого решения. */
  valid?: (entry: Entry) => boolean;
  /** Версия формата: файл с другой версией считается повреждённым. */
  version?: number;
  /** Повреждённый файл: обычно доверие просто забывается, devcontainer не угадывает. */
  broken?: "empty" | "throw";
}

export interface TrustStore<Entry extends TrustRecord> {
  file: () => string;
  /** Все сохранённые решения по настоящим каталогам проектов. */
  read: () => Promise<Record<string, Entry>>;
  /** Синхронное чтение нужно проверкам, которые работают внутри запуска терминала. */
  readSync: () => Record<string, Entry>;
  entry: (root: string) => Promise<Entry | undefined>;
  entrySync: (root: string) => Entry | undefined;
  /** Заменяет или удаляет решение; запись идёт через очередь этого файла. */
  set: (root: string, entry: Entry | null) => Promise<void>;
  /** Очередь записи файла доверия. */
  lock: <T>(task: () => Promise<T>) => Promise<T>;
  /** Полная перезапись; вызывать только под `lock` или из `set`. */
  write: (projects: Record<string, Entry>) => Promise<void>;
  /** Каталоги, у которых уже есть решение. */
  roots: () => Promise<string[]>;
}

/** Файл доверия читается как решения, а не как настройки: чужая форма не должна доверять. */
const BROKEN = "Некорректный файл доверия";

function empty<Entry extends TrustRecord>(): TrustFile<Entry> {
  return { version: 1, projects: {} };
}

function parseEntry<Entry extends TrustRecord>(
  value: unknown,
  shape: TrustStoreShape<Entry>,
): Entry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const entry: Record<string, string> = {};
  for (const field of shape.fields) {
    const item = record[field];
    // Решение без любого из обязательных полей не описывает просмотренный файл.
    if (typeof item !== "string") return undefined;
    entry[field] = item;
  }
  const parsed = entry as Entry;
  return shape.valid && !shape.valid(parsed) ? undefined : parsed;
}

function parseText<Entry extends TrustRecord>(
  text: string,
  shape: TrustStoreShape<Entry>,
): TrustFile<Entry> {
  const value = JSON.parse(text) as { version?: unknown; projects?: unknown };
  if (shape.version !== undefined && value?.version !== shape.version) throw new Error(BROKEN);
  if (!value?.projects || typeof value.projects !== "object" || Array.isArray(value.projects))
    throw new Error(BROKEN);
  const projects: Record<string, Entry> = {};
  for (const [root, item] of Object.entries(value.projects as Record<string, unknown>)) {
    const entry = parseEntry(item, shape);
    if (entry) projects[root] = entry;
  }
  return { version: 1, projects };
}

function damaged<Entry extends TrustRecord>(
  text: string,
  shape: TrustStoreShape<Entry>,
): TrustFile<Entry> {
  try {
    return parseText(text, shape);
  } catch {
    if (shape.broken === "throw") throw new Error(BROKEN);
    return empty();
  }
}

/** Очередь по файлу доверия: параллельные решения не должны потерять чужую запись. */
export function createTrustStore<Entry extends TrustRecord>(
  shape: TrustStoreShape<Entry>,
): TrustStore<Entry> {
  const read = async (): Promise<TrustFile<Entry>> => {
    let text: string;
    try {
      text = await readFile(shape.file(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      if (shape.broken === "throw") throw error;
      return empty();
    }
    return damaged(text, shape);
  };

  const readSync = (): TrustFile<Entry> => {
    let text: string;
    try {
      text = readFileSync(shape.file(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      if (shape.broken === "throw") throw error;
      return empty();
    }
    return damaged(text, shape);
  };

  const write = async (projects: Record<string, Entry>): Promise<void> => {
    const rows: Record<string, Record<string, string>> = {};
    for (const [root, entry] of Object.entries(projects)) {
      const row: Record<string, string> = {};
      for (const field of shape.fields) row[field] = entry[field];
      rows[root] = row;
    }
    const text = `${JSON.stringify({ version: 1, projects: rows }, null, 2)}\n`;
    // Решения приватные: файл остаётся доступен только владельцу даже при необычной umask.
    await writeFileAtomic(shape.file(), text, { mode: 0o600, ownerOnly: true });
  };

  const lock = <T>(task: () => Promise<T>): Promise<T> => withFileLock(shape.file(), task);

  return {
    file: shape.file,
    read: async () => (await read()).projects,
    readSync: () => readSync().projects,
    entry: async (root) => (await read()).projects[root],
    entrySync: (root) => readSync().projects[root],
    lock,
    write,
    roots: async () => Object.keys((await read()).projects),
    set: (root, entry) =>
      lock(async () => {
        const file = await read();
        if (entry) file.projects[root] = entry;
        else delete file.projects[root];
        await write(file.projects);
      }),
  };
}
