<script setup lang="ts">
import UiScrollArea from "../../../common/ui/UiScrollArea.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  FileScope,
  ProjectPath,
  SearchHit,
} from "@ai-projector/core/modules/workspace/index.ts";
import { isLiveScope, SEARCH_QUERY_MAX } from "@ai-projector/core/modules/workspace/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSectionRefresh from "../../../common/ui/UiSectionRefresh.vue";
import { findWorkspacePaths, searchWorkspace } from "../../workspace-api/index.ts";
import { FileIcon, useFileIconTheme } from "../../file-icons/index.ts";
import IconCaseSensitive from "~icons/lucide/case-sensitive";
import IconWholeWord from "~icons/lucide/whole-word";
import IconRegex from "~icons/lucide/regex";
import IconFileText from "~icons/lucide/file-text";
import IconFiles from "~icons/lucide/files";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconFile from "~icons/lucide/file";

const FILE_LIMIT = 100;
type SearchKind = "content" | "files";
const props = defineProps<{ projectId: string; scope?: FileScope }>();
const emit = defineEmits<{
  open: [path: string, line?: number, column?: number];
  reveal: [path: string];
}>();
const query = ref("");
const kind = ref<SearchKind>("content");
const searchCase = ref(false);
const searchWord = ref(false);
const searchRegex = ref(false);
const hits = ref<SearchHit[]>([]);
const paths = ref<ProjectPath[]>([]);
const searchError = ref("");
const searching = ref(false);
const searched = ref(false);
const truncated = ref(false);
const collapsedGroups = ref<Set<string>>(new Set());
const { resolver } = useFileIconTheme();
let searchGeneration = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchAbort: AbortController | undefined;
function byPath(path: string) {
  const parts = path.split("/");
  return { name: parts.at(-1) ?? path, directory: parts.slice(0, -1).join("/") };
}
function iconFor(item: ProjectPath) {
  return resolver.value.resolve({
    name: byPath(item.path).name,
    path: item.path,
    directory: item.directory,
  });
}
async function search() {
  const generation = ++searchGeneration;
  searchAbort?.abort();
  searched.value = false;
  hits.value = [];
  paths.value = [];
  searchError.value = "";
  truncated.value = false;
  if (!query.value.trim()) {
    searching.value = false;
    return;
  }
  searching.value = true;
  searchAbort = new AbortController();
  try {
    if (kind.value === "files") {
      const found = await findWorkspacePaths(
        props.projectId,
        query.value,
        searchAbort.signal,
        props.scope,
        FILE_LIMIT,
      );
      if (generation !== searchGeneration) return;
      paths.value = found;
      truncated.value = found.length >= FILE_LIMIT;
    } else {
      const data = await searchWorkspace(
        props.projectId,
        query.value,
        {
          caseSensitive: searchCase.value,
          wholeWord: searchWord.value,
          regex: searchRegex.value,
        },
        searchAbort.signal,
        props.scope,
      );
      if (generation !== searchGeneration) return;
      hits.value = data.hits;
      truncated.value = data.truncated;
    }
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
  paths.value = [];
  collapsedGroups.value = new Set();
  searched.value = false;
  searching.value = !!query.value.trim();
  searchTimer = setTimeout(() => void search(), 300);
});
watch([searchCase, searchWord, searchRegex, kind], () => {
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
const filesNotice = computed(() => {
  if (!paths.value.length) return "Совпадений нет";
  const files = paths.value.filter((item) => !item.directory).length;
  const folders = paths.value.length - files;
  const counts = [files ? `${files} файлов` : "", folders ? `${folders} папок` : ""].filter(
    Boolean,
  );
  return `${counts.join(" · ")}${truncated.value ? " · показаны первые 100" : ""}`;
});
const fileHits = computed(() =>
  paths.value.map((item) => {
    const place = byPath(item.path);
    return { ...item, name: place.name, folder: place.directory, icon: iconFor(item) };
  }),
);
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
function openPath(item: ProjectPath) {
  if (item.directory) {
    if (!props.scope || isLiveScope(props.scope)) emit("reveal", item.path);
    return;
  }
  emit("open", item.path);
}
/** Повторяет поиск, если запрос не пуст: вызывается после изменений файлов. */
function refresh() {
  if (query.value.trim()) return search();
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
  paths.value = [];
  collapsedGroups.value = new Set();
}
watch(() => props.projectId, reset);
onBeforeUnmount(cancel);
defineExpose({ search, refresh, refreshing: searching });
</script>

<template>
  <UiScrollArea class="side-content search-panel">
    <form
      class="search-form"
      @submit.prevent="search"
      @keydown.ctrl.enter.prevent="search"
      @keydown.meta.enter.prevent="search"
    >
      <UiInline class="search-toolbar" :gap="0.5" justify="between">
        <UiInline :gap="0.5" align="normal" justify="normal">
          <UiInline
            :gap="0.5"
            align="normal"
            justify="normal"
            class="search-options"
            role="group"
            aria-label="Что искать"
          >
            <UiButton
              shape="icon"
              size="sm"
              :active="kind === 'content'"
              :aria-pressed="kind === 'content'"
              title="По содержимому"
              aria-label="По содержимому"
              @click="kind = 'content'"
            >
              <IconFileText aria-hidden="true" />
            </UiButton>
            <UiButton
              shape="icon"
              size="sm"
              :active="kind === 'files'"
              :aria-pressed="kind === 'files'"
              title="По именам файлов"
              aria-label="По именам файлов"
              @click="kind = 'files'"
            >
              <IconFiles aria-hidden="true" />
            </UiButton>
          </UiInline>
          <UiInline
            v-if="kind === 'content'"
            :gap="0.5"
            align="normal"
            justify="normal"
            class="search-options"
            role="group"
            aria-label="Параметры поиска"
          >
            <UiButton
              shape="icon"
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
              shape="icon"
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
              shape="icon"
              size="sm"
              :active="searchRegex"
              :aria-pressed="searchRegex"
              title="Использовать регулярное выражение"
              aria-label="Использовать регулярное выражение"
              @click="searchRegex = !searchRegex"
            >
              <IconRegex aria-hidden="true" />
            </UiButton>
          </UiInline>
        </UiInline>
        <UiSectionRefresh />
      </UiInline>
      <UiControl
        mono
        as="textarea"
        rows="2"
        wrap="soft"
        spellcheck="false"
        v-model="query"
        name="workspace-search"
        :placeholder="kind === 'files' ? 'Найти файл…' : 'Найти в проекте…'"
        :aria-label="kind === 'files' ? 'Поиск по именам файлов' : 'Поиск по содержимому'"
        title="Enter — новая строка, Ctrl+Enter — искать сразу"
        :maxlength="SEARCH_QUERY_MAX"
      />
    </form>
    <UiMessage v-if="searchError" class="notice" tone="danger" size="xs" role="alert">{{
      searchError
    }}</UiMessage>
    <UiMessage v-if="searched && kind === 'content'" class="notice" tone="muted" size="xs">
      {{
        hits.length
          ? `${hits.length} совпадений в ${searchGroups.length} файлах${truncated ? " · показаны первые 200" : ""}`
          : "Совпадений нет"
      }}
    </UiMessage>
    <UiMessage v-if="searched && kind === 'files'" class="notice" tone="muted" size="xs">{{
      filesNotice
    }}</UiMessage>
    <template v-if="kind === 'content'">
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
          <span class="result-file u-truncate">{{ group.name }}</span>
          <span v-if="group.directory" class="result-dir u-truncate">{{ group.directory }}</span>
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
            <span class="snippet">
              ><template v-for="(segment, index) in snippetSegments(hit)" :key="index"
                ><mark v-if="segment.match">{{ segment.text }}</mark
                ><template v-else>{{ segment.text }}</template></template
              ></span
            >
          </button>
        </template>
      </div>
    </template>
    <button
      v-for="item in kind === 'files' ? fileHits : []"
      :key="item.path"
      class="result file-hit"
      :title="item.path"
      @click="openPath(item)"
    >
      <FileIcon :icon="item.icon" :size="13" />
      <span class="result-file u-truncate">{{ item.name }}</span>
      <span v-if="item.folder" class="result-dir u-truncate">{{ item.folder }}</span>
    </button>
  </UiScrollArea>
</template>

<style scoped>
.search-panel form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 2px 10px var(--sp-2);
}
.search-panel form :deep(textarea) {
  display: block;
  width: 100%;
  min-height: calc(2lh + 10px);
  max-height: 12em;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: 1.35;
  resize: none;
  field-sizing: content;
  overflow: auto;
}

.notice {
  padding: 0 var(--sp-3);
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
}
.result-dir {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-2xs);
  color: var(--faint);
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
  align-items: start;
  gap: 10px;
  padding: 5px var(--sp-3);
  width: 100%;
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.file-hit {
  align-items: center;
  gap: 6px;
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
  max-height: 4.8em;
  overflow: hidden;
  font: var(--fs-2xs) var(--mono);
  white-space: pre-wrap;
}
.snippet mark {
  color: inherit;
  background: var(--search);
  border-radius: var(--r-sm);
}
</style>
