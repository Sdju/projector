import {
  commandArgs,
  optionalStringArg,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import type { TrashEntry } from "@ai-projector/core/modules/workspace/index.ts";
import {
  listWorkspaceTrashDirectory,
  workspaceTrashSizes,
} from "../../../../workspace-api/index.ts";
import type { useTrash } from "./trash.ts";

export interface TrashPanelOptions {
  projectId: () => string;
  list: ReturnType<typeof useTrash>;
  /** Opens the irreversible-action dialog; the command itself waits for the next call with `confirm`. */
  confirm: (request: { action: "delete" | "empty"; ids: string[] }) => void;
  /** The tree and Git changed: the workspace reloads them after restore or purge. */
  changed: () => void;
}

const selectionArguments = {
  ids: "string[]: идентификаторы записей из ide.trash.list",
  paths: "string[]: исходные пути записей (альтернатива ids)",
  all: "boolean: выбрать все записи корзины",
};

function strings(value: unknown, key: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && !!item))
    throw new Error(`${key} должен быть массивом непустых строк`);
  return value as string[];
}

/** Commands `ide.trash.*`: listing, restore, permanent deletion and emptying the trash. */
export function useTrashPanel(options: TrashPanelOptions) {
  const list = options.list;
  const commands = useCommandScope(`trash:${options.projectId()}`, () => ({
    surface: "trash",
    projectId: options.projectId(),
    count: list.entries.value.length,
    busy: list.busy.value,
  }));
  const register = useCommandRegistrar(commands.scope);

  function selected(value: unknown): string[] {
    const args = commandArgs(value);
    const entries = list.entries.value;
    const ids = strings(args.ids, "ids");
    if (args.id !== undefined) {
      if (typeof args.id !== "string" || !args.id) throw new Error("id должен быть строкой");
      ids.push(args.id);
    }
    const paths = strings(args.paths, "paths");
    if (args.path !== undefined) {
      if (typeof args.path !== "string" || !args.path) throw new Error("path должен быть строкой");
      paths.push(args.path);
    }
    const resolved = paths.map((path) => {
      const entry = entries.find((item: TrashEntry) => item.path === path);
      if (!entry) throw new Error(`В корзине нет записи «${path}»`);
      return entry.id;
    });
    const result = [...new Set([...ids, ...resolved])];
    if (args.all === true) result.push(...entries.map((entry) => entry.id));
    const unique = [...new Set(result)];
    if (!unique.length) throw new Error("Укажите ids, paths или all");
    const unknown = unique.filter((id) => !entries.some((entry) => entry.id === id));
    if (unknown.length) throw new Error(`Записи корзины не найдены: ${unknown.join(", ")}`);
    return unique;
  }

  register(
    "ide.trash.list",
    "Показать корзину проекта",
    "Возвращает удалённые файлы и папки: идентификатор, исходный путь, признак папки, размер файла и время удаления. Содержимое лежит в .projector-trash, скрыто из дерева, поиска и Git.",
    async () => ({ entries: await list.load() }),
  );
  register(
    "ide.trash.refresh",
    "Обновить корзину",
    "Перечитывает список удалённых записей после изменений в проекте и возвращает его.",
    async () => ({ entries: await list.load() }),
  );
  register(
    "ide.trash.tree",
    "Показать содержимое папки корзины",
    "Возвращает один уровень дерева внутри удалённой папки: ключ, имя, признак папки и размер файла. Путь верхней записи даёт ide.trash.list.",
    async (value) => {
      const path = optionalStringArg(commandArgs(value), "path");
      if (!path) throw new Error("Укажите path записи из ide.trash.list");
      return listWorkspaceTrashDirectory(options.projectId(), path);
    },
    { path: "string: ключ записи или папки внутри неё" },
    () => !list.busy.value,
  );
  register(
    "ide.trash.sizes",
    "Посчитать размеры в корзине",
    "Возвращает рекурсивные размеры и число файлов для прямых детей папки корзины; без path — для верхних записей. Размер папки может быть неполным: truncated=true означает нижнюю границу. Первый подсчёт большой папки ограничен по времени и числу записей, поэтому ответ не блокирует дерево.",
    async (value) =>
      workspaceTrashSizes(options.projectId(), optionalStringArg(commandArgs(value), "path") ?? ""),
    { path: "string (необязательно): ключ папки из ide.trash.tree; пусто — корень корзины" },
    () => !list.busy.value,
  );
  register(
    "ide.trash.restore",
    "Восстановить записи из корзины",
    "Возвращает записи на исходные пути и создаёт недостающие папки. Занятое имя не перезаписывается: запись получает имя «имя (2).расширение». Возвращает восстановленные пути и обновлённый список корзины.",
    async (value) => {
      const result = await list.restore(selected(value));
      options.changed();
      return result;
    },
    selectionArguments,
    () => !list.busy.value && list.entries.value.length > 0,
  );
  register(
    "ide.trash.delete",
    "Удалить записи из корзины навсегда",
    "Стирает выбранные записи с диска без возможности восстановления. Без confirm открывает диалог подтверждения; SDK передаёт confirm: true и список ids, paths или all.",
    async (value) => {
      const ids = selected(value);
      if (commandArgs(value).confirm !== true) {
        options.confirm({ action: "delete", ids });
        return;
      }
      const result = await list.remove(ids);
      options.changed();
      return result;
    },
    { ...selectionArguments, confirm: "boolean: true выполняет удаление без диалога" },
    () => !list.busy.value && list.entries.value.length > 0,
  );
  register(
    "ide.trash.empty",
    "Очистить корзину",
    "Удаляет все записи корзины с диска без возможности восстановления. Без confirm открывает диалог подтверждения; SDK передаёт confirm: true.",
    async (value) => {
      if (commandArgs(value).confirm !== true) {
        options.confirm({ action: "empty", ids: [] });
        return;
      }
      const result = await list.empty();
      options.changed();
      return result;
    },
    { confirm: "boolean: true очищает корзину без диалога" },
    () => !list.busy.value && list.entries.value.length > 0,
  );
  return { commands };
}
