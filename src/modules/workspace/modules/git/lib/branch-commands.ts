import type { Ref } from "vue";
import type { GitBranch } from "../../../../../../core/modules/workspace/index.ts";
import {
  commandArgs,
  optionalStringArg,
  useCommandRegistrar,
  type useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import type { GitBranchesState } from "./git-branches.ts";

export interface BranchCommandContext {
  branches: GitBranchesState;
  commands: ReturnType<typeof useCommandScope>;
  /** Сохраняет открытые файлы до смены ветки; бросает ошибку при неудаче. */
  prepare: (action: string, paths: string[]) => Promise<void>;
  /** Приводит вкладки в соответствие с файлами новой ветки. */
  applied: (action: string, paths: string[]) => Promise<void>;
  /** Перечитывает обзор изменений и историю. */
  reload: () => Promise<void>;
  open: Ref<boolean>;
  target: Ref<string>;
  busy: Ref<boolean>;
  /** Название текущей ветки для подсказки диалога. */
  label: () => string;
  /** Спрашивает имя в диалоге и передаёт его в `run`. */
  ask: (
    title: string,
    value: string,
    description: string,
    run: (name: string) => Promise<void>,
  ) => void;
}

/** Команды `ide.git.branch.*`: список, переключение, создание, переименование и удаление веток. */
export function registerBranchCommands(ctx: BranchCommandContext) {
  const { branches, open, target, busy, ask } = ctx;
  const { state } = branches;
  const register = useCommandRegistrar(ctx.commands.scope);
  const find = (name: unknown): GitBranch => {
    const branch = state.value.branches.find((item) => item.name === name);
    if (!branch) throw new Error(`Ветка не найдена: ${String(name)}`);
    return branch;
  };
  const nameArg = (value?: unknown) => find(commandArgs(value).name ?? target.value);

  /** Операция над ветками; смена HEAD меняет файлы, поэтому вкладки сохраняются до неё и обновляются после. */
  async function apply(
    action: string,
    input: Parameters<GitBranchesState["mutate"]>[1],
    movesHead: boolean,
  ) {
    busy.value = true;
    try {
      if (movesHead) await ctx.prepare("checkout", []);
      await branches.mutate(action, input);
      if (movesHead) await ctx.applied("checkout", []);
      await ctx.reload();
    } finally {
      busy.value = false;
    }
  }
  const idle = () => !busy.value;
  const branchHelp = { name: "Имя ветки (для удалённой — вместе с remote, например origin/main)" };
  register(
    "ide.git.branch.toggle",
    "Показать список веток",
    "Открывает или закрывает выбор ветки.",
    () => {
      open.value = !open.value;
    },
  );
  register(
    "ide.git.branch.refresh",
    "Обновить список веток",
    "Перечитывает локальные и удалённые ветки.",
    () => branches.load(),
  );
  register(
    "ide.git.branch.list",
    "Список веток",
    "Возвращает ветки с upstream, ahead/behind и последним коммитом.",
    async () => {
      await branches.load();
      return state.value;
    },
  );
  register(
    "ide.git.branch.checkout",
    "Переключить ветку",
    "Переключает рабочую папку на ветку; для удалённой создаёт локальную с отслеживанием.",
    async (value) => {
      const branch = nameArg(value);
      if (!branch.current) await apply("checkout", { name: branch.name }, true);
      open.value = false;
    },
    branchHelp,
    (value) => idle() && (!commandArgs(value).name || !!state.value.branches.length),
  );
  register(
    "ide.git.branch.create",
    "Создать ветку…",
    "Создаёт ветку от HEAD или от указанной ветки/коммита и переключается на неё. Без name спрашивает имя.",
    async (value) => {
      const args = commandArgs(value);
      const from =
        optionalStringArg(args, "from") ?? (args.fromTarget === true ? target.value : undefined);
      const run = (name: string) =>
        apply(
          "create",
          { name, from, checkout: args.checkout === false ? false : undefined },
          args.checkout !== false,
        );
      const name = optionalStringArg(args, "name");
      if (name) return run(name);
      ask("Новая ветка", "", from ? `Начало: ${from}` : `Начало: ${ctx.label()}`, run);
    },
    {
      name: "Имя новой ветки",
      from: "Ветка или хеш коммита, от которого начать; по умолчанию HEAD",
      checkout: "false — не переключаться на новую ветку",
    },
    idle,
  );
  register(
    "ide.git.branch.rename",
    "Переименовать ветку…",
    "Переименовывает локальную ветку. Без newName спрашивает имя.",
    async (value) => {
      const args = commandArgs(value);
      const branch = nameArg(value);
      const run = (newName: string) => apply("rename", { name: branch.name, newName }, false);
      const newName = optionalStringArg(args, "newName");
      if (newName) return run(newName);
      ask("Переименовать ветку", branch.name, branch.name, run);
    },
    { ...branchHelp, newName: "Новое имя" },
    (value) => idle() && (!commandArgs(value).name ? target.value !== "" : true),
  );
  register(
    "ide.git.branch.delete",
    "Удалить ветку…",
    "Удаляет локальную ветку. Неслитую ветку удаляет только с force: true.",
    async (value) => {
      const args = commandArgs(value);
      const branch = nameArg(value);
      let force = args.force === true;
      if (args.confirm !== true) {
        const message = branch.merged
          ? `Удалить ветку ${branch.name}?`
          : `Ветка ${branch.name} не слита в текущую. Удалить вместе с её коммитами?`;
        if (!window.confirm(message)) return;
        force = !branch.merged;
      }
      await apply("delete", { name: branch.name, force }, false);
    },
    { ...branchHelp, force: "true — удалить неслитую ветку", confirm: "true — без вопроса" },
    idle,
  );
}
