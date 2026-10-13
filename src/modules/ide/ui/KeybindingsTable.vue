<script setup lang="ts">
import UiScrollArea from "../../../common/ui/UiScrollArea.vue";
import UiTable from "../../../common/ui/UiTable.vue";
import { computed, onScopeDispose, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import UiVirtualList from "../../../common/ui/UiVirtualList.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import UiKbd from "../../../common/ui/UiKbd.vue";
import IconEdit from "~icons/lucide/pencil";
import IconReset from "~icons/lucide/rotate-ccw";
import IconRemove from "~icons/lucide/x";
import type { Keybinding } from "../../../../core/modules/ide/index.ts";
import type { KeybindingRow } from "./keybinding-row.ts";
defineProps<{
  rows: KeybindingRow[];
  busy: boolean;
  resetKey: string;
  displayKey: (key?: string) => string;
  condition: (rule?: Keybinding) => string;
}>();
const emit = defineEmits<{ action: [action: string, row: KeybindingRow] }>();
const scrollArea = ref<InstanceType<typeof UiScrollArea>>();
const scrollElement = computed(() => scrollArea.value?.element ?? null);
const tableHeader = ref<HTMLElement | null>(null);
const { height: measuredHeaderHeight } = useElementSize(tableHeader);
const headerHeight = ref(0);
let headerFrame: number | undefined;
// Updating scrollMargin during observer delivery can resize the table in the same cycle.
watch(measuredHeaderHeight, (height) => {
  if (headerFrame !== undefined) cancelAnimationFrame(headerFrame);
  headerFrame = requestAnimationFrame(() => {
    headerFrame = undefined;
    headerHeight.value = height;
  });
});
onScopeDispose(() => {
  if (headerFrame !== undefined) cancelAnimationFrame(headerFrame);
});
const rowKey = (row: KeybindingRow) => `${row.command}:${row.index}`;
</script>

<template>
  <UiScrollArea ref="scrollArea" class="table-scroll">
    <UiTable :aria-rowcount="rows.length + 1" header-tone="muted" sticky subtle hover>
      <colgroup>
        <col class="command-column" />
        <col class="binding-column" />
        <col class="when-column" />
        <col class="source-column" />
        <col class="actions-column" />
      </colgroup>
      <thead ref="tableHeader">
        <tr>
          <th>Команда</th>
          <th>Сочетание</th>
          <th>Когда</th>
          <th>Источник</th>
          <th><span class="u-sr-only">Действия</span></th>
        </tr>
      </thead>
      <UiVirtualList
        v-slot="{ rows: visibleRows, paddingAfter, measureElement }"
        :items="rows"
        :item-key="rowKey"
        :scroll-element="scrollElement"
        :scroll-margin="headerHeight"
        :reset-key="resetKey"
        :estimate-size="72"
      >
        <tbody>
          <template v-for="{ item: row, index, key, gapBefore } in visibleRows" :key="key">
            <tr v-if="gapBefore" class="virtual-spacer" aria-hidden="true">
              <td colspan="5" :style="{ height: `${gapBefore}px` }" />
            </tr>
            <tr
              :ref="measureElement"
              :data-index="index"
              :data-virtual-index="index"
              :aria-rowindex="index + 2"
              :data-command="row.command"
              @dblclick="!busy && emit('action', 'edit', row)"
            >
              <td>
                <span>{{ row.title }}</span
                ><small>{{ row.command }}</small>
              </td>
              <td>
                <button
                  class="binding"
                  :disabled="busy"
                  :aria-label="`Изменить сочетание: ${row.command}`"
                  @click="emit('action', 'edit', row)"
                >
                  <UiKbd v-if="row.rule && !row.rule.disabled">{{ displayKey(row.rule.key) }}</UiKbd
                  ><span v-else class="muted">Не назначено</span>
                </button>
              </td>
              <td class="when">{{ condition(row.rule) }}</td>
              <td>{{ row.custom ? "Пользователь" : "По умолчанию" }}</td>
              <td class="actions">
                <UiButton
                  shape="icon"
                  size="sm"
                  :disabled="busy"
                  :aria-label="`Изменить: ${row.command}`"
                  title="Изменить сочетание"
                  @click="emit('action', 'edit', row)"
                >
                  <IconEdit />
                </UiButton>
                <UiButton
                  v-if="row.rule && !row.rule.disabled"
                  shape="icon"
                  size="sm"
                  :disabled="busy"
                  :aria-label="`Удалить: ${row.command}`"
                  title="Удалить привязку"
                  @click="emit('action', 'remove', row)"
                >
                  <IconRemove />
                </UiButton>
                <UiButton
                  v-if="row.custom"
                  shape="icon"
                  size="sm"
                  :disabled="busy"
                  :aria-label="`Сбросить: ${row.command}`"
                  title="Восстановить стандартные привязки команды"
                  @click="emit('action', 'reset', row)"
                >
                  <IconReset />
                </UiButton>
              </td>
            </tr>
          </template>
          <tr v-if="paddingAfter" class="virtual-spacer" aria-hidden="true">
            <td colspan="5" :style="{ height: `${paddingAfter}px` }" />
          </tr>
        </tbody>
      </UiVirtualList>
    </UiTable>
    <UiEmpty v-if="!rows.length">Команды не найдены</UiEmpty>
  </UiScrollArea>
</template>

<style scoped>
table {
  table-layout: fixed;
  min-width: 760px;
}
.command-column {
  width: 34%;
}
.binding-column {
  width: 18%;
}
.when-column {
  width: 23%;
}
.source-column {
  width: 15%;
}
.actions-column {
  width: 10%;
}
.virtual-spacer td {
  padding: 0;
  border: 0;
}
th {
  z-index: var(--z-sticky);
}
th:first-child,
td:first-child {
  padding-left: var(--sp-5);
}
td {
  overflow-wrap: anywhere;
}
td:first-child {
  min-width: 180px;
}
small {
  display: block;
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  margin-top: var(--sp-1);
  overflow-wrap: anywhere;
}
.when {
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  min-width: 130px;
}
.binding {
  text-align: left;
  white-space: nowrap;
  min-height: 26px;
}
.muted {
  color: var(--muted);
}
.actions {
  white-space: nowrap;
}
svg {
  width: 13px;
  height: 13px;
}
@media (max-width: 700px) {
  th:first-child,
  td:first-child {
    padding-left: var(--sp-3);
  }
}
</style>
