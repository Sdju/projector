<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { GitBranch } from "../../../../../../core/modules/workspace/index.ts";
import ContextMenu from "../../../../../common/ui/ContextMenu.vue";
import EntryDialog from "../../../../../common/ui/EntryDialog.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import type { ContextMenuItem } from "../../../../../common/ui/context-menu.ts";
import { type useCommandScope } from "../../../../../common/utilities/commands.ts";
import { relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { registerBranchCommands } from "../lib/branch-commands.ts";
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
const menu = ref<InstanceType<typeof ContextMenu>>();
const dialog = ref<InstanceType<typeof EntryDialog>>();
let submit: ((name: string) => Promise<void>) | undefined;
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 60_000);
onBeforeUnmount(() => clearInterval(clock));

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
function ask(
  title: string,
  value: string,
  description: string,
  run: (name: string) => Promise<void>,
) {
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
const busy = ref(false);
registerBranchCommands({
  branches: props.branches,
  commands: props.commands,
  prepare: props.prepare,
  applied: props.applied,
  reload: props.reload,
  open,
  target,
  busy,
  label: () => label.value,
  ask,
});

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
  props.commands.scope.activate();
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
