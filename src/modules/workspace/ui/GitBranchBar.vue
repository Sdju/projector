<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { GitBranch } from "../../../../core/modules/workspace/index.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import EntryDialog from "../../../common/ui/EntryDialog.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import { relativeTime } from "../lib/commit-format.ts";
import type { GitBranchesState } from "../lib/git-branches.ts";
import IconBranch from "~icons/lucide/git-branch";
import IconCheck from "~icons/lucide/check";
import IconPlus from "~icons/lucide/plus";
import IconChevron from "~icons/lucide/chevron-down";

const props = defineProps<{
  branches: GitBranchesState;
  commands: ReturnType<typeof useCommandScope>;
  /** Растёт при каждом обновлении Git: список веток перечитывается следом. */
  revision: number;
  /** Сохраняет открытые файлы до смены ветки; бросает ошибку при неудаче. */
  prepare: (action: string, paths: string[]) => Promise<void>;
  /** Приводит вкладки в соответствие с файлами новой ветки. */
  applied: (action: string, paths: string[]) => Promise<void>;
  /** Перечитывает обзор изменений и историю. */
  reload: () => Promise<void>;
}>();
const open = defineModel<boolean>("open", { default: false });
const target = defineModel<string>("target", { default: "" });
const { state, error, loading } = props.branches;
const filter = ref("");
const busy = ref(false);
const menu = ref<InstanceType<typeof ContextMenu>>();
const dialog = ref<InstanceType<typeof EntryDialog>>();
let submit: ((name: string) => Promise<void>) | undefined;
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 60_000);
const disposers: (() => void)[] = [];
onBeforeUnmount(() => {
  clearInterval(clock);
  disposers.forEach((dispose) => dispose());
});

const current = computed(() => state.value.branches.find((branch) => branch.current));
const label = computed(() =>
  state.value.detached ? `HEAD · ${state.value.current}` : state.value.current,
);
const visible = computed(() => {
  const text = filter.value.trim().toLowerCase();
  const rows = state.value.branches.filter((branch) => branch.name.toLowerCase().includes(text));
  return [
    { label: "Локальные", rows: rows.filter((branch) => branch.kind === "local") },
    { label: "Удалённые", rows: rows.filter((branch) => branch.kind === "remote") },
  ].filter((group) => group.rows.length);
});
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
    if (movesHead) await props.prepare("checkout", []);
    await props.branches.mutate(action, input);
    if (movesHead) await props.applied("checkout", []);
    await props.reload();
  } finally {
    busy.value = false;
  }
}
function ask(title: string, value: string, description: string, run: (name: string) => Promise<void>) {
  submit = run;
  void dialog.value?.open({ title, value, description });
}
async function onSubmit(name: string) {
  try {
    await submit?.(name);
    dialog.value?.close();
  } catch (err) {
    dialog.value?.fail(err instanceof Error ? err.message : "Не удалось выполнить действие");
  }
}
function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value !== undefined && typeof value !== "string") throw new Error(`${key} должен быть строкой`);
  return value as string | undefined;
}

const { scope } = props.commands;
const register = (
  id: string,
  title: string,
  description: string,
  run: (args?: unknown) => unknown,
  args?: Record<string, string>,
  enabled?: (args?: unknown) => boolean,
) => disposers.push(scope.registerCommand({ id, title, description, arguments: args, run, enabled }));
const idle = () => !busy.value;
const branchHelp = { name: "Имя ветки (для удалённой — вместе с remote, например origin/main)" };
register("ide.git.branch.toggle", "Показать список веток", "Открывает или закрывает выбор ветки.", () => {
  open.value = !open.value;
});
register(
  "ide.git.branch.refresh",
  "Обновить список веток",
  "Перечитывает локальные и удалённые ветки.",
  () => props.branches.load(),
);
register(
  "ide.git.branch.list",
  "Список веток",
  "Возвращает ветки с upstream, ahead/behind и последним коммитом.",
  async () => {
    await props.branches.load();
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
    const from = optionalString(args, "from") ?? (args.fromTarget === true ? target.value : undefined);
    const run = (name: string) =>
      apply("create", { name, from, checkout: args.checkout === false ? false : undefined }, args.checkout !== false);
    const name = optionalString(args, "name");
    if (name) return run(name);
    ask("Новая ветка", "", from ? `Начало: ${from}` : `Начало: ${label.value}`, run);
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
    const newName = optionalString(args, "newName");
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

const menuItems = computed<ContextMenuItem[]>(() => {
  const branch = state.value.branches.find((item) => item.name === target.value);
  const args = { name: target.value };
  const { item } = props.commands;
  return [
    item("ide.git.branch.checkout", args),
    item("ide.git.branch.create", { fromTarget: true }, { label: "Создать ветку отсюда…" }),
    ...(branch?.kind === "local" && !branch.current
      ? [
          item("ide.git.branch.rename", args, { separator: true }),
          item("ide.git.branch.delete", args, { danger: true }),
        ]
      : branch?.kind === "local"
        ? [item("ide.git.branch.rename", args, { separator: true })]
        : []),
  ];
});
function context(event: MouseEvent | KeyboardEvent, name: string) {
  target.value = name;
  scope.activate();
  void menu.value?.open(event);
}
const syncText = (branch: GitBranch) =>
  [branch.ahead ? `↑${branch.ahead}` : "", branch.behind ? `↓${branch.behind}` : ""]
    .filter(Boolean)
    .join(" ");

watch(
  () => props.revision,
  () => void props.branches.load(),
  { immediate: true },
);
watch(open, (value) => {
  if (value) void props.branches.load();
  else filter.value = "";
});
</script>

<template>
  <section class="branch-bar" aria-label="Ветки Git">
    <div class="bar">
      <button
        class="current"
        :aria-expanded="open"
        :title="state.detached ? 'HEAD отсоединён от ветки' : 'Сменить ветку'"
        data-command="ide.git.branch.toggle"
        @click="commands.run('ide.git.branch.toggle')"
      >
        <IconBranch class="icon" aria-hidden="true" />
        <span class="name">{{ label }}</span>
        <span v-if="current && syncText(current)" class="sync" title="Относительно upstream">
          {{ syncText(current) }}
        </span>
        <IconChevron class="chevron" :class="{ open }" aria-hidden="true" />
      </button>
      <UiButton
        icon
        size="sm"
        title="Новая ветка"
        aria-label="Новая ветка"
        :disabled="busy"
        data-command="ide.git.branch.create"
        @click="commands.run('ide.git.branch.create')"
      >
        <IconPlus aria-hidden="true" />
      </UiButton>
    </div>
    <div v-if="open" class="picker">
      <input
        v-model="filter"
        type="search"
        placeholder="Найти ветку"
        aria-label="Найти ветку"
        @keydown.stop
      />
      <p v-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="loading && !state.branches.length" class="note" role="status">загрузка…</p>
      <p v-else-if="!visible.length" class="note">Веток нет.</p>
      <template v-for="group in visible" :key="group.label">
        <h4>{{ group.label }}</h4>
        <ul>
          <li v-for="branch in group.rows" :key="branch.name">
            <button
              class="row"
              :class="{ current: branch.current }"
              :disabled="busy"
              :title="`${branch.name}\n${branch.subject}\n${branch.hash}${branch.upstream ? `\nupstream: ${branch.upstream}${branch.gone ? ' (удалён)' : ''}` : ''}`"
              @click="commands.run('ide.git.branch.checkout', { name: branch.name })"
              @focus="target = branch.name"
              @contextmenu="context($event, branch.name)"
              @keydown.shift.f10.prevent="context($event, branch.name)"
            >
              <IconCheck v-if="branch.current" class="mark" aria-label="Текущая ветка" />
              <span v-else class="mark" />
              <span class="label">{{ branch.name }}</span>
              <span v-if="branch.gone" class="gone" title="Upstream удалён">upstream удалён</span>
              <span v-if="syncText(branch)" class="sync">{{ syncText(branch) }}</span>
              <span class="when">{{ relativeTime(branch.date, now) }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>
    <ContextMenu ref="menu" :items="menuItems" label="Действия ветки" />
    <EntryDialog ref="dialog" @submit="onSubmit" />
  </section>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  padding-right: var(--sp-3);
}
.current {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--text);
}
.current:hover {
  background: var(--hover);
}
.icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--run);
}
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
}
.sync {
  flex-shrink: 0;
  font: var(--fs-2xs) var(--mono);
  color: var(--warn);
}
.chevron {
  width: 12px;
  height: 12px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--faint);
}
.chevron.open {
  transform: rotate(180deg);
}
.picker {
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line);
  max-height: 320px;
  overflow: auto;
}
.picker input {
  width: calc(100% - 2 * var(--sp-3));
  margin: 2px var(--sp-3) 4px;
  padding: 3px 8px;
  font-size: var(--fs-xs);
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
h4 {
  margin: 6px var(--sp-3) 2px;
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--faint);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.row:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.row.current {
  color: var(--text);
}
.mark {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--run);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
}
.gone {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--err);
}
.when {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--faint);
}
.note {
  margin: 0;
  padding: 0 var(--sp-3) 4px;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.error {
  color: var(--err);
}
</style>
