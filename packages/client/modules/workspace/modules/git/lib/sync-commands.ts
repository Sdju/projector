import type { Ref } from "vue";
import { ref } from "vue";
import type { GitSyncAction } from "@ai-projector/core/modules/workspace/index.ts";
import {
  useCommandRegistrar,
  type useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import type { GitBranchesState } from "./git-branches.ts";

export interface SyncCommandContext {
  branches: GitBranchesState;
  commands: ReturnType<typeof useCommandScope>;
  /** Сохраняет открытые файлы перед pull; бросает ошибку при неудаче. */
  prepare: (action: string, paths: string[]) => Promise<void>;
  /** Приводит вкладки в соответствие с файлами после pull. */
  applied: (action: string, paths: string[]) => Promise<void>;
  /** Перечитывает обзор изменений и историю. */
  reload: () => Promise<void>;
  busy: Ref<boolean>;
  /** Короткий итог рядом с элементом, который запустил операцию. */
  notify?: (message: string) => void;
}

/** Команды `ide.git.sync.*`: обмен коммитами с удалённым репозиторием. */
export function registerSyncCommands(ctx: SyncCommandContext) {
  const { branches, busy } = ctx;
  const { state } = branches;
  const register = useCommandRegistrar(ctx.commands.scope);
  const syncing = ref<GitSyncAction | "">("");
  const current = () => state.value.branches.find((branch) => branch.current);
  const ready = () => !busy.value && state.value.available && !state.value.detached;
  const remote = () => ready() && !!state.value.remotes.length && !!current();
  const help = {
    action: "Действие синхронизации: fetch, pull или push",
  };

  async function perform(action: GitSyncAction) {
    busy.value = true;
    syncing.value = action;
    try {
      if (action === "pull") await ctx.prepare("checkout", []);
      const result = await branches.sync(action);
      if (action === "pull") await ctx.applied("checkout", []);
      await ctx.reload();
      ctx.notify?.(result.message);
      return result;
    } finally {
      syncing.value = "";
      busy.value = false;
    }
  }

  register(
    "ide.git.sync.fetch",
    "Получить ссылки из удалённого репозитория",
    "Выполняет fetch --prune для текущей ветки и обновляет список веток и историю.",
    () => perform("fetch"),
    help,
    remote,
  );
  register(
    "ide.git.sync.pull",
    "Стянуть изменения (только fast-forward)",
    "Забирает коммиты upstream. Если ветки разошлись, Git отказывается и ничего не сливает; открытые файлы сохраняются до операции.",
    () => perform("pull"),
    help,
    () => {
      const branch = current();
      return remote() && !!branch?.upstream && !branch.gone;
    },
  );
  register(
    "ide.git.sync.push",
    "Отправить коммиты в upstream",
    "Отправляет текущую ветку. Без upstream публикует её в origin или первый доступный remote и назначает его upstream.",
    () => perform("push"),
    help,
    remote,
  );

  return { perform, syncing };
}
