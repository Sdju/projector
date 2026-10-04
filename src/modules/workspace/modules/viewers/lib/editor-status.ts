import { reactive } from "vue";

export type LineEnding = "LF" | "CRLF";

/** Снимок позиции каретки и параметров активного редактора для нижней строки состояния. */
export interface EditorStatus {
  /** Есть ли сейчас активный редактор с фокусом. */
  active: boolean;
  /** Номер строки каретки, начиная с 1. */
  line: number;
  /** Номер столбца каретки, начиная с 1. */
  column: number;
  /** Символов в выделении; 0, если выделения нет. */
  selectedChars: number;
  /** Строк охватывает выделение; 0, если выделения нет. */
  selectedLines: number;
  /** Перевод строк документа. */
  lineEnding: LineEnding | null;
}

const initial: EditorStatus = {
  active: false,
  line: 1,
  column: 1,
  selectedChars: 0,
  selectedLines: 0,
  lineEnding: null,
};

const status = reactive<EditorStatus>({ ...initial });
let nextId = 0;
let currentId = 0;

/** Регистрирует редактор и возвращает идентификатор для последующих отчётов. */
export function acquireEditorStatus(): number {
  return ++nextId;
}

/** Редактор уничтожен: если он был текущим источником статуса, строка очищается. */
export function releaseEditorStatus(id: number): void {
  if (currentId !== id) return;
  currentId = 0;
  Object.assign(status, initial);
}

/** Редактор стал активным (смонтирован или получил фокус): становится источником статуса. */
export function activateEditorStatus(id: number, next: Omit<EditorStatus, "active">): void {
  currentId = id;
  Object.assign(status, next, { active: true });
}

/** Обновление статуса от редактора, если он остаётся текущим. */
export function updateEditorStatus(id: number, next: Omit<EditorStatus, "active">): void {
  if (currentId !== id) return;
  Object.assign(status, next, { active: true });
}

/** Реактивный снимок статуса для строки состояния. */
export function useEditorStatus(): EditorStatus {
  return status;
}
