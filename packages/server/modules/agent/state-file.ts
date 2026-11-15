import { readFile } from "node:fs/promises";
import { setAsideBroken } from "../atomic-files/index.ts";

/** Результат проверки содержимого: `undefined` — форма не та, файл считается повреждённым. */
export interface ParsedState<T> {
  value: T;
  /** Сколько записей отброшено как негодные; остальные остаются в работе. */
  dropped?: number;
}

export type StateFileRead<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  | { status: "broken"; backup: string; problem: string };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const isText = (value: unknown): value is string => typeof value === "string";

/** Число из JSON: `1e999` разбирается в бесконечность, поэтому конечность тоже проверяется. */
export const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Необязательное поле: отсутствие допустимо, присутствие должно быть нужного вида. */
export const optionalField = (
  value: Record<string, unknown>,
  key: string,
  check: (item: unknown) => boolean,
): boolean => value[key] === undefined || check(value[key]);

/**
 * Читает файл долговременного состояния и проверяет его форму.
 *
 * ENOENT — штатное отсутствие записи: это не ошибка, вызывающий получает `missing` без
 * диагностики. Повреждённый JSON и данные неверной формы не подменяются пустым значением молча:
 * файл откладывается рядом (`*.broken-*`), чтобы следующая запись не затёрла испорченные данные,
 * а в лог уходит сообщение с причиной. Прочие ошибки чтения (права, диск) пробрасываются: это не
 * признак испорченного файла и не повод начать с чистого листа.
 */
export async function readStateFile<T>(
  file: string,
  label: string,
  parse: (value: unknown) => ParsedState<T> | undefined,
): Promise<StateFileRead<T>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    return { status: "broken", backup: await shelve(label, file, "повреждён", problem), problem };
  }
  const parsed = parse(value);
  if (!parsed)
    return {
      status: "broken",
      backup: await shelve(label, file, "имеет неверный формат", ""),
      problem: "неверный формат",
    };
  if (parsed.dropped)
    console.error(
      `${label}: ${file} — отброшено записей неверного формата: ${parsed.dropped}; файл сохранён как есть`,
    );
  return { status: "ok", value: parsed.value };
}

/** Уводит испорченный файл в сторону и пишет одну понятную строку в лог. */
async function shelve(
  label: string,
  file: string,
  verdict: string,
  problem: string,
): Promise<string> {
  const backup = await setAsideBroken(file);
  console.error(
    `${label}: ${file} ${verdict} и сохранён как ${backup}${problem ? `: ${problem}` : ""}`,
  );
  return backup;
}
