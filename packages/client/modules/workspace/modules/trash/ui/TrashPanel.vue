<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import { computed, ref, watch } from "vue";
import type { TrashEntry, TrashMutation } from "@ai-projector/core/modules/workspace/index.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiEmpty from "../../../../../common/ui/UiEmpty.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import UiSectionRefresh from "../../../../../common/ui/UiSectionRefresh.vue";
import UiSpinner from "../../../../../common/ui/UiSpinner.vue";
import UiToolbar from "../../../../../common/ui/UiToolbar.vue";
import EntryDialog from "../../../../../common/ui/EntryDialog.vue";
import MiddleTruncate from "../../../../../common/ui/MiddleTruncate.vue";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { notify, reportError } from "../../../../../common/utilities/notice.ts";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { sizeLabel } from "../../../../../common/utilities/release-format.ts";
import { useTrash } from "../lib/trash.ts";
import { useTrashPanel } from "../lib/trash-panel.ts";

/** Sidebar section «Корзина»: a tree of .projector-trash with lazy levels, recursive sizes and restore. */
const props = defineProps<{ projectId: string; revision: number; active?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const list = useTrash(() => props.projectId, { sizes: () => !!props.active });
const dialog = ref<InstanceType<typeof EntryDialog>>();
const pending = ref<{ action: "delete" | "empty"; ids: string[] }>();

interface TrashRow {
  key: string;
  name: string;
  directory: boolean;
  size: number | null;
  depth: number;
  entry?: TrashEntry;
  note?: string;
}

const rows = computed<TrashRow[]>(() => {
  const result: TrashRow[] = [];
  const note = (parent: string, depth: number, text: string) =>
    result.push({
      key: `${parent}\0${text}`,
      name: "",
      directory: false,
      size: null,
      depth,
      note: text,
    });
  const visit = (
    node: { key: string; name: string; directory: boolean; size: number | null },
    depth: number,
    entry?: TrashEntry,
  ) => {
    result.push({ ...node, depth, entry });
    if (!node.directory || !list.expanded.has(node.key)) return;
    const error = list.childrenError.get(node.key);
    if (error) {
      note(node.key, depth + 1, error);
      return;
    }
    const children = list.children.get(node.key);
    if (children === undefined) return;
    if (!children.length) {
      note(node.key, depth + 1, "папка пуста");
      return;
    }
    for (const child of children) visit(child, depth + 1);
    if (list.childrenTruncated.has(node.key)) note(node.key, depth + 1, "Показаны не все записи");
  };
  for (const entry of list.entries.value)
    visit(
      { key: entry.id, name: entry.name, directory: entry.directory, size: entry.size },
      0,
      entry,
    );
  return result;
});

const total = computed(() => {
  let sum = 0;
  let measured = 0;
  let truncated = false;
  for (const entry of list.entries.value) {
    if (!entry.directory) {
      sum += entry.size ?? 0;
      measured++;
      continue;
    }
    const size = list.sizes.get(entry.id);
    if (!size || size.size === null) continue;
    sum += size.size;
    measured++;
    if (size.truncated) truncated = true;
  }
  return {
    sum,
    measured: measured > 0,
    complete: measured === list.entries.value.length,
    truncated,
  };
});
const totalLabel = computed(() => {
  if (!list.entries.value.length) return "";
  if (total.value.complete)
    return `${total.value.truncated ? "≥ " : ""}${sizeLabel(total.value.sum)}`;
  return total.value.measured ? `${sizeLabel(total.value.sum)}…` : "";
});

const indent = (depth: number) => ({
  paddingLeft: `calc(var(--sp-3) + ${depth * 14}px)`,
});

function parentKey(key: string) {
  const index = key.lastIndexOf("/");
  return index < 0 ? "" : key.slice(0, index);
}

function sizeText(row: TrashRow) {
  if (row.note) return "";
  if (!row.directory) return row.size === null ? "" : sizeLabel(row.size);
  const size = list.sizes.get(row.key);
  if (size)
    return size.size === null ? "—" : `${size.truncated ? "≥ " : ""}${sizeLabel(size.size)}`;
  if (list.sizing.has(parentKey(row.key))) return "считается…";
  return "";
}

function sizeTitle(row: TrashRow) {
  if (!row.directory || row.note) return "";
  const size = list.sizes.get(row.key);
  if (!size) return "";
  if (size.size === null) return "Размер не посчитан — обновите раздел";
  const files = countRu(size.files, "файл", "файла", "файлов");
  return size.truncated ? `Неполный размер: посчитано ${files}` : files;
}

const { commands } = useTrashPanel({
  projectId: () => props.projectId,
  list,
  changed: () => emit("changed"),
  confirm: (request) => {
    pending.value = request;
    const description =
      request.action === "empty"
        ? `Все записи корзины (${list.entries.value.length}) будут стёрты с диска. Вернуть их будет нельзя.`
        : `Безвозвратно с диска будет удалено: ${countRu(request.ids.length, "запись", "записи", "записей")}.`;
    dialog.value?.open({
      title: request.action === "empty" ? "Очистить корзину?" : "Удалить навсегда?",
      description,
      confirm: true,
    });
  },
});

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие с корзиной";

async function submit() {
  const request = pending.value;
  if (!request) return;
  try {
    await commands.scope.executeCommand(
      request.action === "empty" ? "ide.trash.empty" : "ide.trash.delete",
      { ids: request.ids, confirm: true },
    );
    pending.value = undefined;
    dialog.value?.close();
  } catch (error) {
    dialog.value?.fail(failure(error));
  }
}

async function restore(entry: TrashEntry, event: MouseEvent) {
  try {
    const result = (await commands.scope.executeCommand("ide.trash.restore", {
      ids: [entry.id],
    })) as TrashMutation;
    const path = result.restored[0]?.path ?? entry.path;
    notify(
      event.currentTarget as HTMLElement,
      path === entry.path ? "Восстановлено" : `Восстановлено как ${path.split("/").at(-1)}`,
      "success",
      path === entry.path ? 1600 : 4000,
    );
  } catch (error) {
    reportError(failure(error));
  }
}

const remove = (entry: TrashEntry) => commands.run("ide.trash.delete", { ids: [entry.id] });
const empty = () => commands.run("ide.trash.empty");

watch(
  () => props.revision,
  () => void list.load(),
);
watch(
  () => props.active,
  (active) => {
    if (active) void list.load();
  },
);
watch(
  () => props.projectId,
  () => {
    list.reset();
    void list.load();
  },
);
void list.load();
defineExpose({ refresh: () => list.refresh() });
</script>

<template>
  <UiScrollArea class="trash-panel">
    <UiToolbar as="header" justify="between" text="xs">
      <span class="heading">
        Корзина
        <span v-if="list.entries.value.length" class="count">{{ list.entries.value.length }}</span>
      </span>
      <UiInline :gap="2">
        <span v-if="totalLabel" class="total" title="Суммарный размер корзины">{{
          totalLabel
        }}</span>
        <UiInline :gap="1">
          <UiButton
            shape="icon"
            size="sm"
            tone="danger"
            title="Удалить все записи корзины навсегда"
            aria-label="Очистить корзину"
            :disabled="!list.entries.value.length || list.busy.value"
            data-command="ide.trash.empty"
            @click="empty"
          >
            <ProjectorIcon name="eraser" aria-hidden="true" />
          </UiButton>
          <UiSectionRefresh />
        </UiInline>
      </UiInline>
    </UiToolbar>
    <UiMessage v-if="list.error.value" variant="note" tone="danger" role="alert">{{
      list.error.value
    }}</UiMessage>
    <UiLoader v-if="list.loading.value && !list.entries.value.length" :padding="3"
      >загрузка корзины…</UiLoader
    >
    <UiEmpty v-else-if="!list.entries.value.length" density="compact" align="start">
      Корзина пуста. Удалённые файлы и папки появляются здесь и остаются в
      <code>.projector-trash</code>, пока вы их не восстановите или не очистите.
    </UiEmpty>
    <ul v-else class="tree" role="tree" aria-label="Удалённые записи">
      <li
        v-for="row in rows"
        :key="row.key"
        class="row"
        :class="{ note: row.note, root: !!row.entry }"
        :style="indent(row.depth)"
        :role="row.note ? 'none' : 'treeitem'"
        :aria-level="row.note ? undefined : row.depth + 1"
        :aria-expanded="row.directory && !row.note ? list.expanded.has(row.key) : undefined"
      >
        <span v-if="row.note" class="note-text">{{ row.note }}</span>
        <template v-else>
          <button
            v-if="row.directory"
            class="chevron"
            type="button"
            :aria-label="list.expanded.has(row.key) ? 'Свернуть папку' : 'Развернуть папку'"
            @click="list.toggle(row.key)"
          >
            <UiSpinner v-if="list.childrenLoading.has(row.key)" size="sm" />
            <ProjectorIcon
              name="chevron-right"
              v-else
              class="chevron-icon"
              :class="{ open: list.expanded.has(row.key) }"
              aria-hidden="true"
            />
          </button>
          <span v-else class="chevron" aria-hidden="true" />
          <ProjectorIcon
            :name="row.directory ? 'folder' : 'file'"
            class="kind"
            aria-hidden="true"
          />
          <div class="main">
            <MiddleTruncate :text="row.name" class="name" />
            <div v-if="row.entry" class="meta">
              <span :title="absoluteTime(row.entry.deletedAt)">{{
                relativeTime(row.entry.deletedAt)
              }}</span>
            </div>
          </div>
          <span class="size" :title="sizeTitle(row)">{{ sizeText(row) }}</span>
          <div v-if="row.entry" class="actions">
            <UiButton
              shape="icon"
              size="sm"
              title="Восстановить"
              :aria-label="`Восстановить ${row.entry.path}`"
              :disabled="list.busy.value"
              data-command="ide.trash.restore"
              @click="restore(row.entry, $event)"
            >
              <ProjectorIcon name="archive-restore" aria-hidden="true" />
            </UiButton>
            <UiButton
              shape="icon"
              size="sm"
              tone="danger"
              title="Удалить навсегда"
              :aria-label="`Удалить навсегда ${row.entry.path}`"
              :disabled="list.busy.value"
              data-command="ide.trash.delete"
              @click="remove(row.entry)"
            >
              <ProjectorIcon name="trash-2" aria-hidden="true" />
            </UiButton>
          </div>
          <span v-else class="actions-spacer" aria-hidden="true" />
        </template>
      </li>
    </ul>
    <EntryDialog ref="dialog" @submit="submit" />
  </UiScrollArea>
</template>

<style scoped>
.trash-panel {
  display: flex;
  flex-direction: column;
}
.heading {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  color: var(--faint);
}
.total {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tree {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding-right: var(--sp-2);
  border-top: 1px solid var(--line);
}
.row:hover {
  background: var(--hover);
}
.row.note {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.note-text {
  padding: 4px 0;
}
.chevron {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  color: var(--muted);
}
.chevron-icon {
  width: 14px;
  height: 14px;
  transition: transform var(--t-fast);
}
.chevron-icon.open {
  transform: rotate(90deg);
}
.kind {
  flex: none;
  width: 15px;
  height: 15px;
  color: var(--muted);
}
.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 5px 0;
}
.name {
  color: var(--text-2);
  font-size: var(--fs-xs);
}
.row.root > .main > .name {
  color: var(--text);
}
.meta {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.size {
  flex: none;
  min-width: 48px;
  max-width: 84px;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions,
.actions-spacer {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: 2px;
  min-width: 54px;
}
.actions {
  opacity: 0;
  transition: opacity var(--t-fast);
}
.row:hover .actions,
.row:focus-within .actions {
  opacity: 1;
}
@media (hover: none) {
  .actions {
    opacity: 1;
  }
}
</style>
