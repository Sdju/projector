import { inject, provide, reactive, type InjectionKey } from "vue";

export type LineEnding = "LF" | "CRLF";

/** Снимок позиции каретки и выделения редактора для строки состояния вкладки. */
export interface EditorStatus {
  /** В этой вкладке сейчас есть редактор. */
  active: boolean;
  /** Номер строки каретки, начиная с 1. */
  line: number;
  /** Номер столбца каретки, начиная с 1. */
  column: number;
  /** Символов в выделении; 0, если выделения нет. */
  selectedChars: number;
  /** Строк охватывает выделение; 0, если выделения нет. */
  selectedLines: number;
}

/** Отчёт редактора: всё, кроме признака активности, которым распоряжается строка состояния. */
export type EditorStatusReport = Omit<EditorStatus, "active">;

/** Независимый источник статуса одной вкладки: редактор пишет, строка состояния читает. */
export interface EditorStatusStore {
  readonly status: EditorStatus;
  /** Регистрирует редактор и возвращает идентификатор для последующих отчётов. */
  acquire(): number;
  /** Редактор уничтожен: если он был текущим источником статуса, строка очищается. */
  release(id: number): void;
  /** Редактор стал активным (смонтирован или получил фокус): становится источником статуса. */
  activate(id: number, next: EditorStatusReport): void;
  /** Обновление статуса от редактора, если он остаётся текущим. */
  update(id: number, next: EditorStatusReport): void;
}

const initial: EditorStatus = {
  active: false,
  line: 1,
  column: 1,
  selectedChars: 0,
  selectedLines: 0,
};

/** Создаёт источник статуса для одной вкладки. */
export function createEditorStatusStore(): EditorStatusStore {
  const status = reactive<EditorStatus>({ ...initial });
  let nextId = 0;
  let currentId = 0;
  return {
    status,
    acquire: () => ++nextId,
    release(id) {
      if (currentId !== id) return;
      currentId = 0;
      Object.assign(status, initial);
    },
    activate(id, next) {
      currentId = id;
      Object.assign(status, next, { active: true });
    },
    update(id, next) {
      if (currentId !== id) return;
      Object.assign(status, next, { active: true });
    },
  };
}

const editorStatusKey: InjectionKey<EditorStatusStore> = Symbol("editor-status");

/** Создаёт статус вкладки и отдаёт его потомкам: редактору и строке состояния. */
export function provideEditorStatus(): EditorStatusStore {
  const store = createEditorStatusStore();
  provide(editorStatusKey, store);
  return store;
}

let fallback: EditorStatusStore | undefined;

/** Источник статуса ближайшей вкладки; вне вкладки — общий, чтобы редактор работал сам по себе. */
export function useEditorStatusStore(): EditorStatusStore {
  return inject(editorStatusKey, null) ?? (fallback ??= createEditorStatusStore());
}

/** Перевод строк документа по первому переводу в тексте. */
export function detectLineEnding(content: string): LineEnding {
  const index = content.indexOf("\n");
  return index > 0 && content[index - 1] === "\r" ? "CRLF" : "LF";
}
