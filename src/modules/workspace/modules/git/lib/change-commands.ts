import { computed, type Ref } from "vue";
import type { GitOverview } from "../../../../../../core/modules/workspace/index.ts";
import { commandArgs, type useCommandScope } from "../../../../../common/utilities/commands.ts";
import type { GitOverviewState } from "./git-overview.ts";

export interface ChangeCommandContext {
  commands: ReturnType<typeof useCommandScope>;
  overview: GitOverviewState;
  /** Строка под курсором: путь и список (Staged или Changed). */
  target: Ref<{ path: string; staged: boolean }>;
  busy: Ref<boolean>;
  /** Сохраняет открытые файлы и ждёт записи перед изменением Git; бросает ошибку при неудаче. */
  prepare: (action: string, paths: string[]) => Promise<void>;
  /** Сбрасывает незавершённое открытие файла: ответ Git устарел для него. */
  invalidate: () => void;
  /** Приводит вкладки и дерево в соответствие с новым состоянием Git. */
  applied: (action: string, paths: string[]) => Promise<void>;
  open: (path: string, staged: boolean | undefined, pinned: boolean) => void;
}

/** Команды над изменениями рабочей папки: открыть diff или файл, Staged, Unstaged и откат. */
export function registerChangeCommands(ctx: ChangeCommandContext) {
  const { commands: gitCommands, target: gitTarget, busy: gitBusy } = ctx;
  const { git } = ctx.overview;
  const stagedChanges = computed(() =>
    git.value.changes.filter((change) => change.index !== " " && change.index !== "?"),
  );
  const workingChanges = computed(() =>
    git.value.changes.filter((change) => change.worktree !== " "),
  );
  function gitArgs(value?: unknown) {
    const args = commandArgs(value);
    if (args.path !== undefined && typeof args.path !== "string")
      throw new Error("path должен быть строкой");
    if (args.staged !== undefined && typeof args.staged !== "boolean")
      throw new Error("staged должен быть boolean");
    return {
      path: (args.path as string | undefined) ?? gitTarget.value.path,
      staged: (args.staged as boolean | undefined) ?? gitTarget.value.staged,
      confirm: args.confirm === true,
      pinned: args.pinned === true,
    };
  }
  function gitChange(value?: unknown) {
    return git.value.changes.find((change) => change.path === gitArgs(value).path);
  }
  function gitSelection(value: unknown, staged: boolean) {
    const { path } = gitArgs(value);
    return (staged ? stagedChanges.value : workingChanges.value).filter(
      (change) => !path || change.path === path || change.path.startsWith(`${path}/`),
    );
  }
  const hasConflict = (change: GitOverview["changes"][number]) =>
    change.index === "U" ||
    change.worktree === "U" ||
    ["AA", "DD"].includes(change.index + change.worktree);
  for (const [action, title] of [
    ["openDiff", "Открыть изменения"],
    ["openFile", "Открыть файл"],
    ["stage", "Отметить Staged"],
    ["unstage", "Убрать из Staged"],
    ["discard", "Откатить рабочие изменения…"],
  ] as const) {
    gitCommands.scope.registerCommand({
      id: `ide.git.${action}`,
      title,
      enabled: (value) => {
        if (gitBusy.value) return false;
        if (action === "stage" || action === "unstage") {
          const selection = gitSelection(value, action === "unstage");
          return (
            !!selection.length &&
            (action === "stage" || selection.every((change) => !hasConflict(change)))
          );
        }
        const change = gitChange(value);
        if (!change) return false;
        if (action === "openFile")
          return change.worktree !== "D" && !(change.index === "D" && change.worktree === " ");
        if (action === "openDiff")
          return (
            !hasConflict(change) &&
            (gitArgs(value).staged ? ![" ", "?"].includes(change.index) : change.worktree !== " ")
          );
        return change.worktree !== " " && !hasConflict(change);
      },
      run: async (value) => {
        const { path, staged, confirm, pinned } = gitArgs(value);
        if (action === "openFile" || action === "openDiff")
          return ctx.open(path, action === "openDiff" ? staged : undefined, pinned);
        if (
          action === "discard" &&
          !confirm &&
          !window.confirm(
            gitChange(value)?.index === "?"
              ? `Убрать новый файл ${path}? Он будет перемещён в .projector-trash.`
              : `Откатить рабочие изменения ${path} до подготовленной версии? Несохранённый черновик тоже будет удалён.`,
          )
        )
          return;
        const paths =
          action === "discard"
            ? [path]
            : gitSelection(value, action === "unstage").map((change) => change.path);
        gitBusy.value = true;
        try {
          await ctx.prepare(action, paths);
          ctx.invalidate();
          await ctx.overview.mutate(action, action === "discard" ? path : paths);
          await ctx.applied(action, paths);
        } finally {
          gitBusy.value = false;
        }
      },
    });
  }
  return { gitChange, stagedChanges, workingChanges };
}
