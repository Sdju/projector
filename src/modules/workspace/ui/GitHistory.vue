<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { layoutGraph } from "../../../../core/modules/workspace/index.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import type { GitHistoryState } from "../lib/git-history.ts";
import GitCommitRow from "./GitCommitRow.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconRefresh from "~icons/lucide/refresh-cw";

const props = defineProps<{
  history: GitHistoryState;
  commands: ReturnType<typeof useCommandScope>;
  /** Растёт при каждом обновлении Git: открытая история перечитывается следом. */
  revision: number;
}>();
const emit = defineEmits<{
  openCommit: [hash: string];
  openDiff: [hash: string, path: string];
  openFile: [path: string];
}>();
const target = defineModel<{ hash: string; path: string }>("target", {
  default: () => ({ hash: "", path: "" }),
});
const open = defineModel<boolean>("open", { default: false });
const { log, commits, query, all, loading, loadingMore, error, details } = props.history;
const expanded = ref(new Set<string>());
const search = ref(query.value);
const menu = ref<InstanceType<typeof ContextMenu>>();
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 60_000);
onBeforeUnmount(() => clearInterval(clock));

const MAX_COLUMNS = 6;
const rows = computed(() => layoutGraph(commits.value));
const columns = computed(() => Math.min(MAX_COLUMNS, Math.max(1, ...rows.value.map((r) => r.width))));
const resolve = (value: unknown) => {
  if (typeof value !== "string" || !value) throw new Error("Укажите хеш коммита");
  return commits.value.find((commit) => commit.hash.startsWith(value))?.hash ?? value;
};
const hashArg = (value?: unknown) => resolve(commandArgs(value).hash ?? target.value.hash);
function pathArg(value?: unknown) {
  const path = commandArgs(value).path ?? target.value.path;
  if (typeof path !== "string" || !path) throw new Error("Укажите путь файла");
  return path;
}
async function setExpanded(hash: string, value: boolean) {
  if (value) {
    expanded.value.add(hash);
    await props.history.detail(hash);
  } else expanded.value.delete(hash);
}
async function copy(hash: string) {
  await navigator.clipboard.writeText(hash);
}

const { scope } = props.commands;
const disposers: (() => void)[] = [];
onBeforeUnmount(() => disposers.forEach((dispose) => dispose()));
const register = (
  id: string,
  title: string,
  description: string,
  run: (args?: unknown) => unknown,
  args?: Record<string, string>,
) => disposers.push(scope.registerCommand({ id, title, description, arguments: args, run }));
const hashHelp = { hash: "Хеш коммита (можно сокращённый); без него — коммит под курсором" };
const pathHelp = { path: "Путь файла относительно папки проекта" };
register("ide.git.history.toggle", "Показать или скрыть историю Git", "Сворачивает блок History.", () => {
  open.value = !open.value;
});
register("ide.git.history.refresh", "Обновить историю Git", "Перечитывает загруженную историю.", () => {
  open.value = true;
  return props.history.load();
});
register(
  "ide.git.history.filter",
  "Фильтр истории Git",
  "Ищет коммиты по сообщению; с «@» — по автору. Можно включить все ветки.",
  async (value) => {
    const args = commandArgs(value);
    if (args.query !== undefined && typeof args.query !== "string")
      throw new Error("query должен быть строкой");
    if (args.all !== undefined && typeof args.all !== "boolean")
      throw new Error("all должен быть boolean");
    open.value = true;
    search.value = (args.query as string | undefined) ?? search.value;
    await props.history.filter({ query: search.value, all: args.all as boolean | undefined });
  },
  { query: "Строка поиска; пустая сбрасывает фильтр", all: "true — показать все ветки" },
);
register("ide.git.history.more", "Показать ещё коммиты", "Подгружает следующую страницу.", () =>
  props.history.more(),
);
register(
  "ide.git.commit.toggle",
  "Раскрыть или свернуть коммит",
  "Показывает изменения именно этого коммита.",
  async (value) => {
    const hash = hashArg(value);
    open.value = true;
    await setExpanded(hash, !expanded.value.has(hash));
  },
  hashHelp,
);
register(
  "ide.git.commit.open",
  "Открыть обзор коммита",
  "Открывает вкладку с подробным обзором коммита.",
  (value) => emit("openCommit", hashArg(value)),
  hashHelp,
);
register(
  "ide.git.commit.openDiff",
  "Открыть изменения файла в коммите",
  "Открывает diff файла: родитель коммита → коммит.",
  (value) => emit("openDiff", hashArg(value), pathArg(value)),
  { ...hashHelp, ...pathHelp },
);
register(
  "ide.git.commit.openFile",
  "Открыть текущий файл коммита",
  "Открывает файл проекта в редакторе.",
  (value) => emit("openFile", pathArg(value)),
  pathHelp,
);
register(
  "ide.git.commit.copyHash",
  "Копировать хеш коммита",
  "Копирует полный хеш в буфер обмена.",
  (value) => copy(hashArg(value)),
  hashHelp,
);

const menuItems = computed<ContextMenuItem[]>(() => {
  const args = { ...target.value };
  const { item } = props.commands;
  return args.path
    ? [item("ide.git.commit.openDiff", args), item("ide.git.commit.openFile", args)]
    : [
        item("ide.git.commit.toggle", args),
        item("ide.git.commit.open", args),
        item("ide.git.commit.copyHash", args, { separator: true }),
      ];
});
function context(event: MouseEvent | KeyboardEvent, hash: string, path: string) {
  target.value = { hash, path };
  scope.activate();
  void menu.value?.open(event);
}

const refilter = useDebounceFn(() => props.history.filter({ query: search.value }), 300);
watch(search, (value) => {
  if (value !== query.value) void refilter();
});
watch(open, (value) => {
  if (value && !commits.value.length && !loading.value) void props.history.load();
});
watch(
  () => props.revision,
  () => {
    if (open.value) void props.history.load();
  },
);
// Expanded commits are immutable, but the list may no longer contain them after a filter.
watch(commits, (list) => {
  const known = new Set(list.map((commit) => commit.hash));
  for (const hash of [...expanded.value]) if (!known.has(hash)) expanded.value.delete(hash);
});
</script>

<template>
  <section class="history" aria-label="История Git">
    <div class="head">
      <button
        class="toggle"
        :aria-expanded="open"
        data-command="ide.git.history.toggle"
        @click="open = !open"
      >
        <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
        <h3>History</h3>
        <span v-if="log.ahead" class="sync" title="Не отправлено в upstream">↑{{ log.ahead }}</span>
        <span v-if="log.behind" class="sync" title="Есть в upstream, нет локально">
          ↓{{ log.behind }}
        </span>
      </button>
      <UiButton
        v-if="open"
        icon
        size="sm"
        :disabled="loading"
        title="Обновить историю"
        aria-label="Обновить историю"
        data-command="ide.git.history.refresh"
        @click="commands.run('ide.git.history.refresh')"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
    </div>
    <template v-if="open">
      <div class="filter">
        <input
          v-model="search"
          type="search"
          placeholder="Сообщение или @автор"
          aria-label="Поиск по истории"
          @keydown.stop
        />
        <UiButton
          size="sm"
          :aria-pressed="all"
          title="Показать коммиты всех веток"
          data-command="ide.git.history.filter"
          @click="commands.run('ide.git.history.filter', { all: !all })"
        >
          {{ all ? "Все ветки" : "Текущая" }}
        </UiButton>
      </div>
      <p v-if="log.upstream" class="note">
        {{ log.upstream }}<template v-if="!log.ahead && !log.behind"> · синхронизировано</template>
      </p>
      <p v-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="loading && !commits.length" class="note" role="status">загрузка истории…</p>
      <p v-else-if="log.available && !commits.length" class="note">
        {{ query ? "Ничего не найдено." : "Коммитов пока нет." }}
      </p>
      <ul v-if="commits.length" class="commits">
        <GitCommitRow
          v-for="(commit, index) in commits"
          :key="commit.hash"
          :commit="commit"
          :row="rows[index]!"
          :columns="columns"
          :expanded="expanded.has(commit.hash)"
          :state="details[commit.hash]"
          :me="log.me"
          :now="now"
          @toggle="commands.run('ide.git.commit.toggle', { hash: commit.hash })"
          @open="commands.run('ide.git.commit.open', { hash: commit.hash })"
          @copy="commands.run('ide.git.commit.copyHash', { hash: commit.hash })"
          @open-diff="
            commands.run('ide.git.commit.openDiff', { hash: commit.hash, path: $event })
          "
          @target="target = { hash: commit.hash, path: $event }"
          @context="(event, path) => context(event, commit.hash, path)"
        />
      </ul>
      <div v-if="log.next !== null" class="more">
        <UiButton
          size="sm"
          :disabled="loadingMore"
          data-command="ide.git.history.more"
          @click="commands.run('ide.git.history.more')"
        >
          {{ loadingMore ? "Загрузка…" : "Показать ещё" }}
        </UiButton>
      </div>
    </template>
    <ContextMenu ref="menu" :items="menuItems" label="Действия коммита" />
  </section>
</template>

<style scoped>
.head {
  /* Заголовок остаётся на виду при прокрутке списка. */
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-sunken);
  display: flex;
  align-items: center;
  padding-right: var(--sp-3);
}
.toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px var(--sp-3) 4px 8px;
  text-align: left;
}
h3 {
  margin: 0;
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
.chevron {
  width: 12px;
  height: 12px;
  color: var(--faint);
}
.chevron.open {
  transform: rotate(90deg);
}
.sync {
  margin-left: 6px;
  font: var(--fs-2xs) var(--mono);
  color: var(--warn);
}
.filter {
  display: flex;
  gap: 6px;
  padding: 2px var(--sp-3) 6px;
}
.filter input {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  font-size: var(--fs-xs);
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.note {
  margin: 0;
  padding: 0 var(--sp-3) 4px;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
.commits {
  list-style: none;
  margin: 0;
  padding: 0;
}
.more {
  display: flex;
  justify-content: center;
  padding: var(--sp-2);
}
</style>
