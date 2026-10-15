/**
 * The largest text file the editor takes: a file is read into one string, which V8 cannot make
 * longer than about 512 MB, and the page holds a copy of it too.
 */
export const MAX_TEXT_BYTES = 256 * 1024 * 1024;

/** From this size a file is opened only after the user confirms. */
export const LARGE_FILE_BYTES = 10 * 1024 * 1024;

/** The question asked before a large file is opened. */
export function largeFileQuestion(path: string, size: number): string {
  const megabytes = (size / 1024 / 1024).toLocaleString("ru", { maximumFractionDigits: 1 });
  return `Файл ${path.split("/").pop() || path} весит ${megabytes} МБ. Редактор может открыть его медленно или подвиснуть. Открыть?`;
}
