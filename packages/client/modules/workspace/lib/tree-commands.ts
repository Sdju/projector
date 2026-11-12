import { commandArgs } from "../../../common/utilities/commands.ts";
import { findWorkspacePaths, searchWorkspace } from "../../workspace-api/index.ts";
import type { WorkspaceCapabilities, WorkspaceCapability } from "../../workspace-api/index.ts";
import type { FileScope } from "@ai-projector/core/modules/workspace/index.ts";

export interface TreeCommandsContext {
  projectId: string;
  capabilities: Readonly<WorkspaceCapabilities>;
  /** Opens a read-only tree or comparison section in the sidebar. */
  openTree(scope: FileScope): void;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
}

/** Commands that read committed snapshots; profiles without snapshots keep them disabled. */
export function registerTreeCommands(ctx: TreeCommandsContext) {
  const { capabilities } = ctx;
  ctx.register(
    "ide.workbench.tree.search",
    "Искать в снимке",
    async (value) => {
      const args = commandArgs(value);
      if (typeof args.rev !== "string" || !args.rev) throw new Error("Укажите rev");
      if (typeof args.q !== "string" || !args.q.trim()) throw new Error("Укажите q");
      for (const key of ["case", "word", "regex"])
        if (args[key] !== undefined && typeof args[key] !== "boolean")
          throw new Error(`${key} должен быть boolean`);
      return searchWorkspace(
        ctx.projectId,
        args.q,
        {
          caseSensitive: args.case === true,
          wholeWord: args.word === true,
          regex: args.regex === true,
        },
        undefined,
        { kind: "commit", rev: args.rev },
      );
    },
    () => capabilities.search && capabilities.snapshots,
    undefined,
    {
      description:
        "Ищет текст в файлах коммита и возвращает совпадения с путями и позициями. Несколько строк — вхождение фрагмента целиком. Локальный снимок читается через git grep, GitLab — через поиск по blobs с ref; GitHub не поддерживает поиск по произвольному коммиту. Найденные файлы открываются в том же коммите.",
      arguments: {
        rev: "Хеш коммита",
        q: "Текст поиска; несколько строк — вхождение фрагмента целиком",
        case: "true — учитывать регистр",
        word: "true — искать целое слово",
        regex: "true — регулярное выражение",
      },
    },
  );
  ctx.register(
    "ide.workbench.paths.find",
    "Найти файлы по имени",
    async (value) => {
      const args = commandArgs(value);
      if (typeof args.q !== "string") throw new Error("Укажите q");
      if (args.rev !== undefined && typeof args.rev !== "string")
        throw new Error("rev должен быть строкой");
      return findWorkspacePaths(
        ctx.projectId,
        args.q,
        undefined,
        args.rev ? { kind: "commit", rev: args.rev } : undefined,
      );
    },
    () => true,
    undefined,
    {
      description:
        "Ищет файлы и папки по имени или фрагменту пути. Без rev — рабочая копия; с rev — дерево коммита. Локальный снимок читается через git ls-tree; тот же поиск, что у поля «Файлы» в разделе Поиск и у @ в чате.",
      arguments: {
        q: "Имя или фрагмент пути",
        rev: "Хеш коммита; без него — рабочая копия",
      },
    },
  );
  ctx.register(
    "ide.workbench.tree.open",
    "Открыть дерево файлов снимка",
    (value) => {
      const args = commandArgs(value);
      const stringArg = (key: string) => {
        const item = args[key];
        if (item !== undefined && typeof item !== "string")
          throw new Error(`${key} должен быть строкой`);
        return item as string | undefined;
      };
      const rev = stringArg("rev");
      const from = stringArg("from");
      const to = stringArg("to");
      if (rev) ctx.openTree({ kind: "commit", rev });
      else if (from && to) ctx.openTree({ kind: "compare", from, to });
      else throw new Error("Укажите rev или пару from/to");
    },
    () => capabilities.snapshots || capabilities.compare,
    undefined,
    {
      description:
        "Открывает в боковой панели read-only дерево файлов коммита или список изменений двух коммитов. Для коммита передайте rev; для сравнения — from и to. Хеши должны быть полными или однозначно разрешаться Git провайдера.",
      arguments: {
        rev: "Хеш коммита для дерева файлов",
        from: "Начальный хеш сравнения",
        to: "Конечный хеш сравнения",
      },
    },
  );
}
