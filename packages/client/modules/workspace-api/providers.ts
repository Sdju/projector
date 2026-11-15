import {
  treePageRange,
  type FileContent,
  type FileEntry,
  type TreePage,
} from "@ai-projector/core/modules/workspace/index.ts";
import type { FilesProvider, GitProvider, ReadProvider, WorkspaceFeatures } from "./profile.ts";
import type { WorkspaceParams } from "./actions.ts";

/** Отказ провайдера: действие не реализовано для этого источника workspace. */
export const WORKSPACE_ACTION_UNAVAILABLE = "Действие недоступно для этого источника workspace";

/**
 * Провайдер нумерованного ресурса (issue, pull request, discussion): действие списка и действие
 * одной записи. Разбор номера остаётся общим, конкретные запросы хост передаёт замыканиями.
 */
export function numberedReadProvider(
  listAction: string,
  itemAction: string,
  noun: string,
  repository: string,
  list: (repository: string, params: WorkspaceParams, signal?: AbortSignal) => Promise<unknown>,
  item: (repository: string, number: number, signal?: AbortSignal) => Promise<unknown>,
): ReadProvider {
  return {
    read(action, params, signal) {
      if (action === listAction) return list(repository, params, signal);
      if (action === itemAction) {
        const number = Number(params.number);
        if (!Number.isInteger(number) || number <= 0) throw new Error(`Укажите номер ${noun}`);
        return item(repository, number, signal);
      }
      throw new Error(WORKSPACE_ACTION_UNAVAILABLE);
    },
  };
}

/** Возможности источника только для чтения: без терминалов, Docker, агента и настроек. */
export const readonlyWorkspaceFeatures: Readonly<WorkspaceFeatures> = Object.freeze({
  terminals: false,
  docker: false,
  agent: false,
  settings: false,
  persist: false,
  externalFiles: false,
});

/** Файлы профиля подключения: корень и пустое дерево, остальное требует авторизации. */
export function connectionFilesProvider(root: () => string, message: string): FilesProvider {
  return {
    assetUrl: () => "",
    async read(action) {
      if (action === "root") return { root: root() };
      if (action === "tree") return { entries: [], truncated: false };
      throw new Error(message);
    },
  };
}

/**
 * История снимка: Git-действия читаются по закреплённому коммиту, рабочей копии нет.
 * `snapshot` возвращает текущие метаданные источника, чтобы обновление ref'а было видно.
 */
export function snapshotGitProvider(options: {
  repository: string;
  snapshot: () => { branch: string; commit: string };
  readGit: (action: string, params: WorkspaceParams, signal?: AbortSignal) => Promise<unknown>;
}): GitProvider {
  return {
    allBranches: false,
    async read(action, params, signal) {
      const snapshot = options.snapshot();
      if (action === "git") return { available: true, branch: snapshot.branch, changes: [] };
      if (action === "gutter") return { available: false, original: "" };
      if (!["log", "commit", "commit-diff"].includes(action))
        throw new Error(WORKSPACE_ACTION_UNAVAILABLE);
      return options.readGit(
        action,
        { ...params, repository: options.repository, sha: snapshot.commit },
        signal,
      );
    },
  };
}

/** Запись дерева снимка так, как её отдают хосты: папка, файл, исполняемый файл или подмодуль. */
export interface SnapshotTreeEntry {
  name: string;
  type: string;
  mode: string;
}

/** Страница дерева снимка: общая сортировка и постраничность, разметка записи одна у всех хостов. */
export function snapshotTreePage(
  entries: SnapshotTreeEntry[],
  folder: string,
  params: WorkspaceParams,
): TreePage {
  const mapped: FileEntry[] = entries.map((entry) => ({
    name: entry.name,
    path: folder ? `${folder}/${entry.name}` : entry.name,
    directory: entry.type === "tree",
    executable: entry.mode === "100755",
    disabled: entry.type === "commit",
  }));
  const page = treePageRange(mapped, folder, params);
  return {
    entries: mapped.slice(page.offset, page.end),
    truncated: page.nextOffset !== null,
    total: page.total,
    nextOffset: page.nextOffset,
  };
}

/** Файл снимка только для чтения; SVG показывается текстом, остальные изображения — как image. */
export function readonlyFileContent(
  path: string,
  file: { content: string; binary?: boolean; size?: number; image?: string | null },
): FileContent & { image: boolean } {
  return {
    path,
    content: file.content,
    binary: file.binary,
    size: file.size,
    readonly: true,
    image: !!file.image && !/\.svg$/i.test(path),
  };
}
