<script setup lang="ts">
import { computed, ref } from "vue";
import type { ArchiveContent, ArchiveEntry } from "../../../../core/modules/workspace/index.ts";
const props = defineProps<{ archive: ArchiveContent }>();
const query = ref("");
const entries = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return props.archive.entries.filter((entry) => entry.path.toLocaleLowerCase().includes(needle));
});
const totalSize = computed(() => props.archive.entries.reduce((sum, entry) => sum + entry.size, 0));
const types: Record<ArchiveEntry["type"], string> = {
  file: "Файл",
  directory: "Папка",
  symlink: "Символическая ссылка",
  hardlink: "Жёсткая ссылка",
  other: "Другая запись",
};
function bytes(value: number) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024)
    return `${(value / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`;
  return `${(value / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}
function date(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("ru-RU");
}
</script>

<template>
  <section class="archive-viewer" aria-label="Содержимое архива">
    <div class="archive-summary">
      <strong>{{ archive.format }}</strong>
      <span>Архив: {{ bytes(archive.size) }}</span>
      <span>{{ archive.entries.length }}{{ archive.truncated ? "+" : "" }} записей</span>
      <span
        >{{ archive.truncated ? "Размер показанных записей" : "Размер содержимого" }}:
        {{ bytes(totalSize) }}</span
      >
    </div>
    <input
      v-model="query"
      type="search"
      placeholder="Фильтр по пути…"
      aria-label="Фильтр содержимого архива"
    />
    <p v-if="archive.truncated" class="notice" role="status">
      Показана часть содержимого: достигнут лимит 5000 записей или 256 МБ чтения.
    </p>
    <div class="archive-list">
      <table v-if="entries.length">
        <thead>
          <tr>
            <th scope="col">Путь</th>
            <th scope="col">Тип</th>
            <th scope="col">Размер</th>
            <th scope="col">Изменён</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in entries" :key="index">
            <td class="entry-path">
              <span>{{ entry.path }}</span
              ><small v-if="entry.link">→ {{ entry.link }}</small>
            </td>
            <td>{{ types[entry.type] }}</td>
            <td class="entry-size">{{ entry.type === "file" ? bytes(entry.size) : "—" }}</td>
            <td>{{ date(entry.modified) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">
        {{
          archive.entries.length
            ? "Совпадений нет"
            : archive.truncated
              ? "Записи недоступны в пределах лимита просмотра"
              : "Архив пуст"
        }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.archive-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px;
  gap: 14px;
  box-sizing: border-box;
}
.archive-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  font-size: 12px;
  color: var(--muted, #9299ad);
}
.archive-summary strong {
  color: var(--text, #e1e5ef);
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #ffffff20;
  border-radius: 6px;
  color: inherit;
  background: #ffffff06;
}
.archive-list {
  min-height: 0;
  overflow: auto;
  flex: 1;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}
th {
  position: sticky;
  top: 0;
  background: var(--panel, #171b25);
  font-weight: 500;
}
th,
td {
  padding: 10px;
  border-bottom: 1px solid #ffffff12;
  vertical-align: top;
}
td:not(.entry-path) {
  white-space: nowrap;
  color: var(--muted, #9299ad);
}
.entry-path {
  min-width: 160px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-family: monospace;
}
.entry-path small {
  display: block;
  color: var(--muted, #9299ad);
  margin-top: 4px;
}
.entry-size {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.notice,
.empty {
  font-size: 12px;
  color: var(--muted, #9299ad);
  margin: 0;
}
</style>
