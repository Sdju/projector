import { pathsFromDataTransfer } from "../../../../path-drop/index.ts";

/** Один файл (или пустая папка, если `file` нет) из браузера с путём относительно места бросания. */
export interface DroppedEntry {
  path: string;
  file?: File;
}
/** Что принёс drop: пути на диске (файловый менеджер) либо файлы, которые придётся загружать. */
export type DropSource =
  | { kind: "paths"; paths: string[] }
  | { kind: "files"; entries: Promise<DroppedEntry[]> };

const readEntries = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
const readFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: FileSystemEntry, prefix: string, into: DroppedEntry[]) {
  const path = prefix + entry.name;
  if (entry.isFile) {
    into.push({ path, file: await readFile(entry as FileSystemFileEntry) });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const before = into.length;
  // `readEntries` отдаёт папку порциями: читаем, пока не придёт пустая.
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader))
    for (const child of batch) await walk(child, path + "/", into);
  if (into.length === before) into.push({ path });
}

/**
 * Читает drop. Вызывать синхронно, до первого `await`: после этого `DataTransfer` пустеет,
 * поэтому записи и файлы берутся сразу, а обход папок идёт уже по ним.
 */
export function readDrop(data: DataTransfer): DropSource {
  const paths = pathsFromDataTransfer(data);
  if (paths.length) return { kind: "paths", paths };
  const roots = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => ({ entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile() }));
  const loose = roots.length ? [] : [...data.files];
  const entries = (async () => {
    const found: DroppedEntry[] = loose.map((file) => ({ path: file.name, file }));
    for (const { entry, file } of roots) {
      if (entry) await walk(entry, "", found);
      else if (file) found.push({ path: file.name, file });
    }
    return found;
  })();
  // Ошибку обхода получит тот, кто ждёт результат; до этого браузер не должен считать её потерянной.
  entries.catch(() => undefined);
  return { kind: "files", entries };
}

/** Имя верхнего уровня: первый компонент относительного пути или последний — абсолютного. */
export const topLevelName = (path: string) => path.split("/")[0]!;
export const baseName = (path: string) => path.replace(/\/+$/, "").split("/").at(-1) ?? "";
