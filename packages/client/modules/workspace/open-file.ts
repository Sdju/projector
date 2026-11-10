import {
  fileScopeKey,
  isLiveScope,
  type FileContent,
  type FileScope,
} from "@projector-ai/core/modules/workspace/index.ts";
import type { TabParams } from "../workspace-api/index.ts";

export interface OpenFile extends FileContent {
  /** Id зарегистрированного типа служебной вкладки (`TabType`) или `commit`. */
  virtual?: string;
  /** Параметры типа вкладки: по ним строится ключ и восстанавливается сессия. */
  params?: TabParams;
  /** Полный хеш: вкладка обзора коммита или diff файла в этом коммите. */
  commit?: string;
  /** Короткий хеш родителя в diff коммита; пусто у корневого коммита. */
  parent?: string;
  /** Номер merge request, к которому относится diff-вкладка. */
  pull?: number;
  /** Снимок, из которого прочитан файл; отсутствует у рабочей копии. */
  scope?: FileScope;
  /** Old path of a renamed file in a comparison. */
  originalPath?: string;
  external?: boolean;
  image?: string;
  localFile?: File;
  original?: string;
  staged?: boolean;
  line?: number;
  /** Last line of the range a link points at; with `line`, the editor selects it. */
  endLine?: number;
  column?: number;
  key: string;
  draft?: string;
  markdownMode?: "document" | "source";
  /** Счётчик ручных перезагрузок страницы в iframe. */
  htmlReload?: number;
  /** Файл на диске расходится с правками во вкладке (`disk`) или недоступен (`error`). */
  conflict?: { disk?: string; error?: string };
  saving?: boolean;
  saveError?: string;
  /** Вкладка предварительного просмотра: одна на блок, курсивом; закрепляется двойным щелчком. */
  preview?: boolean;
}

/** Как открыть файл: перечитать, внешний путь, вкладка предпросмотра (по умолчанию да). */
export interface OpenFileOptions {
  reload?: boolean;
  external?: boolean;
  preview?: boolean;
  /** Read the file from a snapshot instead of the working copy. */
  scope?: FileScope;
  /** Old path of a renamed file in a comparison. */
  originalPath?: string;
  /** Не показывать ошибку открытия: восстановление сессии не ругается на устаревшие вкладки. */
  quiet?: boolean;
  /** Last line of the range to reveal; only meaningful with `line`. */
  endLine?: number;
}

/** A file of the working copy; absent scope is the same as an explicit live one. */
export const isLiveFile = (file: OpenFile) => !file.scope || isLiveScope(file.scope);

/** Key of a file tab; live keys keep their historical shape so saved sessions still open. */
export function fileTabKey(
  path: string,
  options: { external?: boolean; staged?: boolean; scope?: FileScope } = {},
) {
  const scope = options.scope;
  if (scope && !isLiveScope(scope)) {
    const part = scope.kind === "commit" ? `rev:${scope.rev}` : fileScopeKey(scope);
    return `${path}:${part}`;
  }
  return `${options.external ? "external:" : ""}${path}:${options.staged === undefined ? "file" : options.staged ? "index" : "working"}`;
}

/** Diff against the Git index shows the real file on the right, so it can be edited in place. */
export const isEditable = (file: OpenFile) =>
  !file.readonly &&
  isLiveFile(file) &&
  !file.binary &&
  !file.virtual &&
  !file.external &&
  !file.image &&
  !file.archive &&
  (file.original === undefined || file.staged === false);
export const isMarkdown = (file: OpenFile) =>
  (!file.scope || file.scope.kind !== "compare") &&
  !file.virtual &&
  !file.binary &&
  !file.image &&
  file.original === undefined &&
  /\.(?:md|markdown)$/i.test(file.path);
export const isHtml = (file: OpenFile) =>
  isLiveFile(file) &&
  !file.virtual &&
  !file.binary &&
  !file.image &&
  !file.external &&
  file.original === undefined &&
  /\.html?$/i.test(file.path);
