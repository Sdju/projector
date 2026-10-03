<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { SearchHit } from "../../../../core/modules/workspace/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import { searchWorkspace } from "../../workspace-api/index.ts";
import IconCaseSensitive from "~icons/lucide/case-sensitive";
import IconWholeWord from "~icons/lucide/whole-word";
import IconRegex from "~icons/lucide/regex";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconFile from "~icons/lucide/file";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ open: [path: string, line: number, column: number] }>();
const query = ref("");
const searchCase = ref(false);
const searchWord = ref(false);
const searchRegex = ref(false);
const hits = ref<SearchHit[]>([]);
const searchError = ref("");
const searching = ref(false);
const searched = ref(false);
const truncated = ref(false);
const collapsedGroups = ref<Set<string>>(new Set());
let searchGeneration = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchAbort: AbortController | undefined;
async function search() {
  const generation = ++searchGeneration;
  searchAbort?.abort();
  searched.value = false;
  hits.value = [];
  searchError.value = "";
  truncated.value = false;
  if (!query.value.trim()) {
    searching.value = false;
    return;
  }
  searching.value = true;
  searchAbort = new AbortController();
  try {
    const data = await searchWorkspace(
      props.projectId,
      query.value,
      {
        caseSensitive: searchCase.value,
        wholeWord: searchWord.value,
        regex: searchRegex.value,
      },
      searchAbort.signal,
    );
    if (generation !== searchGeneration) return;
    hits.value = data.hits;
    truncated.value = data.truncated;
    searched.value = true;
  } catch (err) {
    if (generation === searchGeneration && !searchAbort.signal.aborted)
      searchError.value = err instanceof Error ? err.message : "Ошибка поиска";
  } finally {
    if (generation === searchGeneration) searching.value = false;
  }
}
watch(query, () => {
  clearTimeout(searchTimer);
  ++searchGeneration;
  searchAbort?.abort();
  hits.value = [];
  collapsedGroups.value = new Set();
  searched.value = false;
  searching.value = !!query.value.trim();
  searchTimer = setTimeout(() => void search(), 300);
});
watch([searchCase, searchWord, searchRegex], () => {
  clearTimeout(searchTimer);
  if (query.value.trim()) void search();
});
interface SearchGroup {
  path: string;
  name: string;
  directory: string;
  hits: SearchHit[];
}
const searchGroups = computed<SearchGroup[]>(() => {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits.value) {
    const list = groups.get(hit.path) ?? [];
    list.push(hit);
    groups.set(hit.path, list);
  }
  return [...groups.entries()].map(([path, list]) => {
    const parts = path.split("/");
    return {
      path,
      name: parts.at(-1) ?? path,
      directory: parts.slice(0, -1).join("/"),
      hits: list,
    };
  });
});
function toggleGroup(path: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedGroups.value = next;
}
interface SnippetSegment {
  text: string;
  match: boolean;
}
function snippetSegments(hit: SearchHit): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let cursor = 0;
  for (const match of hit.matches ?? []) {
    const start = Math.max(match.start, cursor);
    if (start >= hit.text.length) break;
    if (start > cursor) segments.push({ text: hit.text.slice(cursor, start), match: false });
    segments.push({ text: hit.text.slice(start, match.end), match: true });
    cursor = Math.max(cursor, match.end);
  }
  if (cursor < hit.text.length) segments.push({ text: hit.text.slice(cursor), match: false });
  return segments;
}
/** Повторяет поиск, если запрос не пуст: вызывается после изменений файлов. */
function refresh() {
  if (query.value.trim()) void search();
}
function cancel() {
  ++searchGeneration;
  searchAbort?.abort();
  clearTimeout(searchTimer);
}
function reset() {
  cancel();
  query.value = "";
  hits.value = [];
  collapsedGroups.value = new Set();
}
watch(() => props.projectId, reset);
onBeforeUnmount(cancel);
defineExpose({ search, refresh });
</script>

<template>
  <div class="side-content search-panel">
    <form class="search-form" @submit.prevent="search">
      <div class="search-box">
        <input
          v-model="query"
          type="search"
          placeholder="Найти в проекте…"
          aria-label="Поиск по содержимому"
          maxlength="200"
        />
        <div class="search-options" role="group" aria-label="Параметры поиска">
          <UiButton
            icon
            size="sm"
            :active="searchCase"
            :aria-pressed="searchCase"
            title="Учитывать регистр"
            aria-label="Учитывать регистр"
            @click="searchCase = !searchCase"
          >
            <IconCaseSensitive aria-hidden="true" />
          </UiButton>
          <UiButton
            icon
            size="sm"
            :active="searchWord"
            :aria-pressed="searchWord"
            title="Только слово целиком"
            aria-label="Только слово целиком"
            @click="searchWord = !searchWord"
          >
            <IconWholeWord aria-hidden="true" />
          </UiButton>
          <UiButton
            icon
            size="sm"
            :active="searchRegex"
            :aria-pressed="searchRegex"
            title="Использовать регулярное выражение"
            aria-label="Использовать регулярное выражение"
            @click="searchRegex = !searchRegex"
          >
            <IconRegex aria-hidden="true" />
          </UiButton>
        </div>
      </div>
    </form>
    <p v-if="searching" class="notice" role="status">поиск…</p>
    <p v-if="searchError" class="notice error" role="alert">{{ searchError }}</p>
    <p v-if="searched" class="notice">
      {{
        hits.length
          ? `${hits.length} совпадений в ${searchGroups.length} файлах${truncated ? " · показаны первые 200" : ""}`
          : "Совпадений нет"
      }}
    </p>
    <div v-for="group in searchGroups" :key="group.path" class="result-group">
      <button
        class="result-group-header"
        type="button"
        :aria-expanded="!collapsedGroups.has(group.path)"
        :title="group.path"
        @click="toggleGroup(group.path)"
      >
        <IconChevronDown v-if="!collapsedGroups.has(group.path)" aria-hidden="true" />
        <IconChevronRight v-else aria-hidden="true" />
        <IconFile class="result-file-icon" aria-hidden="true" />
        <span class="result-file">{{ group.name }}</span>
        <span v-if="group.directory" class="result-dir">{{ group.directory }}</span>
        <span class="result-count">{{ group.hits.length }}</span>
      </button>
      <template v-if="!collapsedGroups.has(group.path)">
        <button
          v-for="hit in group.hits"
          :key="`${hit.path}:${hit.line}:${hit.column}`"
          class="result"
          :title="`${hit.path}:${hit.line}`"
          @click="emit('open', hit.path, hit.line, hit.column)"
        >
          <span class="result-line">{{ hit.line }}</span>
          <span class="snippet"
            ><template v-for="(segment, index) in snippetSegments(hit)" :key="index"
              ><mark v-if="segment.match">{{ segment.text }}</mark
              ><template v-else>{{ segment.text }}</template></template
            ></span
          >
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-panel form {
  margin: 2px 10px var(--sp-2);
}
.search-box {
  display: flex;
  align-items: center;
  gap: 2px;
}
.search-box input {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
}
.search-options {
  display: flex;
  gap: 2px;
}

.notice {
  padding: 0 var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
.result-group {
  border-bottom: 1px solid var(--line);
}
.result-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  color: var(--muted);
}
.result-group-header:hover {
  background: var(--hover);
}
.result-group-header > svg:first-child {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.result-file-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.result-file {
  font-size: var(--fs-xs);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-dir {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-2xs);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 1px 5px;
  text-align: center;
  font: var(--fs-2xs) var(--mono);
  color: var(--text);
  background: var(--bg-4);
  border-radius: var(--r-lg);
}
.result {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px var(--sp-3);
  width: 100%;
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.result:hover {
  background: var(--hover);
}
.result-line {
  flex-shrink: 0;
  min-width: 2ch;
  text-align: right;
  font: var(--fs-2xs) var(--mono);
  color: var(--faint);
}
.snippet {
  flex: 1;
  min-width: 0;
  font: var(--fs-2xs) var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet mark {
  color: inherit;
  background: var(--search);
  border-radius: var(--r-sm);
}
</style>
