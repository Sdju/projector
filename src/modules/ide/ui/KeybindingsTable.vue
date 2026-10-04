<script setup lang="ts">
import { ref } from "vue";
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
const scrollElement = ref<HTMLElement | null>(null);
const tableHeader = ref<HTMLElement | null>(null);
const { height: headerHeight } = useElementSize(tableHeader);
const rowKey = (row: KeybindingRow) => `${row.command}:${row.index}`;
</script>

<template>
  <div ref="scrollElement" class="table-scroll">
    <table :aria-rowcount="rows.length + 1">
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
          <th><span class="sr-only">Действия</span></th>
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
                  icon
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
                  icon
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
                  icon
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
    </table>
    <UiEmpty v-if="!rows.length">Команды не найдены</UiEmpty>
  </div>
</template>

<style scoped>
.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
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
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: var(--bg-2);
  color: var(--muted);
  font-weight: 500;
  border-bottom: 1px solid var(--line);
}
th,
td {
  padding: var(--sp-3) var(--sp-3);
}
th:first-child,
td:first-child {
  padding-left: var(--sp-5);
}
td {
  overflow-wrap: anywhere;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
}
tr:hover td {
  background: var(--hover);
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
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (max-width: 700px) {
  th:first-child,
  td:first-child {
    padding-left: var(--sp-3);
  }
}
</style>
