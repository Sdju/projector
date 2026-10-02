<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { workspaceRequest, saveWorkspaceMarkdown } from "../api.ts";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { relocatedPath } from "../../../../core/modules/workspace/index.ts";
import WorkspaceTabs from "../../../common/ui/WorkspaceTabs.vue";
import FileTree from "./FileTree.vue";
import GitChangesTree from "./GitChangesTree.vue";
import ArchiveViewer from "./ArchiveViewer.vue";
import IconSettings from "~icons/lucide/settings";
import IconRefresh from "~icons/lucide/rotate-cw";
import { TerminalPane } from "../../terminal/index.ts";
import type {
  FileContent,
  SearchHit,
  GitOverview,
  FileComparison,
} from "../../../../core/modules/workspace/index.ts";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const MarkdownViewer = defineAsyncComponent(() => import("./MarkdownViewer.vue"));
const props = defineProps<{ projectId: string }>();
const workspaceElement = ref<HTMLElement>();
const treeWidth = ref<number>();
const agentWidth = ref<number>();
const sizes = computed(() => ({
  "--tree-width": treeWidth.value ? `${treeWidth.value}px` : undefined,
  "--agent-width": agentWidth.value ? `${agentWidth.value}px` : undefined,
}));
let sizeObserver: ResizeObserver | undefined;
onMounted(() => {
  sizeObserver = new ResizeObserver(() => {
    const element = workspaceElement.value;
    if (!element || window.innerWidth <= 1050) return;
    const width = element.clientWidth;
    if (treeWidth.value !== undefined)
      treeWidth.value = Math.max(160, Math.min(treeWidth.value, width - 300 - 268));
    if (agentWidth.value !== undefined)
      agentWidth.value = Math.max(
        300,
        Math.min(agentWidth.value, width - element.querySelector(".sidebar")!.clientWidth - 268),
      );
  });
  if (workspaceElement.value) sizeObserver.observe(workspaceElement.value);
});
let stopResize: (() => void) | undefined;
function resizePane(event: PointerEvent, pane: "tree" | "agent") {
  const element = workspaceElement.value;
  if (!element || window.innerWidth <= 1050) return;
  stopResize?.();
  (event.currentTarget as HTMLElement).focus();
  event.preventDefault();
  const rect = element.getBoundingClientRect();
  const move = (moveEvent: PointerEvent) => {
    if (pane === "tree")
      treeWidth.value = Math.max(
        160,
        Math.min(
          moveEvent.clientX - rect.left,
          rect.width -
            (agentWidth.value ?? element.querySelector(".agent-pane")!.clientWidth) -
            268,
        ),
      );
    else
      agentWidth.value = Math.max(
        300,
        Math.min(
          rect.right - moveEvent.clientX,
          rect.width - (treeWidth.value ?? element.querySelector(".sidebar")!.clientWidth) - 268,
        ),
      );
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    stopResize = undefined;
  };
  stopResize = finish;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
function resizeKey(event: KeyboardEvent, pane: "tree" | "agent") {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !workspaceElement.value) return;
  event.preventDefault();
  const element = workspaceElement.value;
  const amount = event.key === "ArrowRight" ? 20 : -20;
  if (pane === "tree")
    treeWidth.value = Math.max(
      160,
      Math.min(
        (treeWidth.value ?? element.querySelector(".sidebar")!.clientWidth) + amount,
        element.clientWidth - element.querySelector(".agent-pane")!.clientWidth - 268,
      ),
    );
  else
    agentWidth.value = Math.max(
      300,
      Math.min(
        (agentWidth.value ?? element.querySelector(".agent-pane")!.clientWidth) - amount,
        element.clientWidth - element.querySelector(".sidebar")!.clientWidth - 268,
      ),
    );
}
const section = ref<"files" | "search" | "git" | "project">("files");
const revision = ref(0);
const query = ref("");
const hits = ref<SearchHit[]>([]);
const searchError = ref("");
const searching = ref(false);
const searched = ref(false);
const truncated = ref(false);
const git = ref<GitOverview>({ available: false, branch: "", changes: [] });
const gitError = ref("");
const gitLoading = ref(false);
const fileError = ref("");
const loading = ref(false);
interface OpenFile extends FileContent {
  original?: string;
  staged?: boolean;
  line?: number;
  column?: number;
  key: string;
  draft?: string;
  markdownMode?: "preview" | "edit" | "split";
  saving?: boolean;
  saveError?: string;
}
const isMarkdown = (file: OpenFile) =>
  file.original === undefined && /\.(?:md|markdown)$/i.test(file.path);
const isDirty = (file: OpenFile) => file.draft !== undefined && file.draft !== file.content;
const tabs = ref<OpenFile[]>([]);
const activeKey = ref("");
const fileTabs = computed(() =>
  tabs.value.map((tab) => ({
    id: tab.key,
    label: `${tab.path.split("/").at(-1)}${isDirty(tab) ? " •" : ""}${tab.original !== undefined ? (tab.staged ? " · index" : " · diff") : ""}`,
    title: tab.path,
  })),
);
function reorderTabs(ids: string[]) {
  const files = new Map(tabs.value.map((tab) => [tab.key, tab]));
  tabs.value = ids.map((id) => files.get(id)!);
}
const active = computed(() => tabs.value.find((file) => file.key === activeKey.value));
const stagedChanges = computed(() =>
  git.value.changes.filter((change) => change.index !== " " && change.index !== "?"),
);
const workingChanges = computed(() =>
  git.value.changes.filter((change) => change.worktree !== " "),
);
let fileGeneration = 0;
let gitGeneration = 0;
let searchGeneration = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchAbort: AbortController | undefined;
async function openFile(
  path: string,
  line?: number,
  column?: number,
  staged?: boolean,
  reload = false,
) {
  const key = `${path}:${staged === undefined ? "file" : staged ? "index" : "working"}`;
  const existing = tabs.value.find((tab) => tab.key === key);
  if (existing && (!reload || isDirty(existing) || existing.saving)) {
    selectTab(key);
    existing.line = line;
    existing.column = column;
    if (line && isMarkdown(existing)) existing.markdownMode = "edit";
    return;
  }
  const generation = ++fileGeneration;
  loading.value = true;
  fileError.value = "";
  try {
    const data =
      staged === undefined
        ? await workspaceRequest<FileContent>(props.projectId, "file", { path })
        : await workspaceRequest<FileComparison>(props.projectId, "diff", {
            path,
            staged: String(staged),
          });
    if (generation !== fileGeneration) return;
    const file: OpenFile = {
      path,
      content: "modified" in data ? data.modified : data.content,
      archive: "archive" in data ? data.archive : undefined,
      original: "original" in data ? data.original : undefined,
      staged,
      line,
      column,
      key,
      markdownMode: line ? "edit" : (existing?.markdownMode ?? "preview"),
    };
    const index = tabs.value.findIndex((tab) => tab.key === key);
    if (index === -1) tabs.value.push(file);
    else tabs.value[index] = file;
    activeKey.value = key;
  } catch (err) {
    if (generation === fileGeneration)
      fileError.value = err instanceof Error ? err.message : "Не удалось открыть файл";
  } finally {
    if (generation === fileGeneration) loading.value = false;
  }
}
function closeTab(key: string) {
  const index = tabs.value.findIndex((tab) => tab.key === key);
  const tab = tabs.value[index];
  if (!tab || tab.saving) return;
  if (isDirty(tab) && !window.confirm(`Закрыть ${tab.path} без сохранения изменений?`)) return;
  tabs.value.splice(index, 1);
  if (key === activeKey.value)
    activeKey.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.key ?? "";
}
function selectTab(key: string) {
  ++fileGeneration;
  loading.value = false;
  fileError.value = "";
  activeKey.value = key;
}
async function saveMarkdown() {
  const file = active.value;
  if (!file || !isMarkdown(file) || !isDirty(file) || file.saving) return;
  const content = file.draft!;
  file.saving = true;
  file.saveError = "";
  try {
    await saveWorkspaceMarkdown(props.projectId, file.path, content, file.content);
    file.content = content;
    void loadGit();
  } catch (error) {
    file.saveError = error instanceof Error ? error.message : "Не удалось сохранить файл";
  } finally {
    file.saving = false;
  }
}
function canLeave() {
  if (tabs.value.some((file) => file.saving)) return false;
  return (
    !tabs.value.some(isDirty) ||
    window.confirm("Есть несохранённые изменения Markdown. Уйти без сохранения?")
  );
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate((to, from) => to.params.id === from.params.id || canLeave());
function beforeUnload(event: BeforeUnloadEvent) {
  if (!tabs.value.some((file) => isDirty(file) || file.saving)) return;
  event.preventDefault();
  event.returnValue = "";
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
async function loadGit() {
  const generation = ++gitGeneration;
  gitLoading.value = true;
  gitError.value = "";
  try {
    const data = await workspaceRequest<GitOverview>(props.projectId, "git");
    if (generation === gitGeneration) git.value = data;
  } catch (err) {
    if (generation === gitGeneration)
      gitError.value = err instanceof Error ? err.message : "Ошибка Git";
  } finally {
    if (generation === gitGeneration) gitLoading.value = false;
  }
}
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
    const data = await workspaceRequest<{ hits: SearchHit[]; truncated: boolean }>(
      props.projectId,
      "search",
      { q: query.value },
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
  searched.value = false;
  searching.value = !!query.value.trim();
  searchTimer = setTimeout(() => void search(), 300);
});
watch(
  () => props.projectId,
  () => {
    ++fileGeneration;
    ++gitGeneration;
    ++searchGeneration;
    searchAbort?.abort();
    clearTimeout(searchTimer);
    tabs.value = [];
    activeKey.value = "";
    fileError.value = "";
    loading.value = false;
    query.value = "";
    hits.value = [];
    void loadGit();
  },
  { immediate: true },
);
watch(section, (value) => {
  if (value === "git") void loadGit();
});
async function refresh() {
  revision.value++;
  await loadGit();
  if (section.value === "search") await search();
  if (active.value)
    void openFile(
      active.value.path,
      active.value.line,
      active.value.column,
      active.value.staged,
      true,
    );
}
function entryMoved(source: string, destination: string) {
  ++fileGeneration;
  loading.value = false;
  for (const tab of [...tabs.value]) {
    const path = relocatedPath(tab.path, source, destination);
    if (path === tab.path) continue;
    if (tab.staged !== undefined) {
      closeTab(tab.key);
      continue;
    }
    const wasActive = tab.key === activeKey.value;
    tab.path = path;
    tab.key = `${path}:file`;
    if (wasActive) activeKey.value = tab.key;
  }
  revision.value++;
  void loadGit();
  if (query.value.trim()) void search();
}
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", beforeUnload);
  stopResize?.();
  sizeObserver?.disconnect();
  ++fileGeneration;
  ++gitGeneration;
  ++searchGeneration;
  clearTimeout(searchTimer);
  searchAbort?.abort();
});
</script>

<template>
  <div ref="workspaceElement" class="workspace" :style="sizes">
    <aside class="sidebar" aria-label="Обзор проекта">
      <nav class="side-tabs" aria-label="Разделы проекта">
        <button :class="{ selected: section === 'files' }" @click="section = 'files'">Файлы</button>
        <button :class="{ selected: section === 'search' }" @click="section = 'search'">
          Поиск
        </button>
        <button :class="{ selected: section === 'git' }" @click="section = 'git'">
          Git <span v-if="git.changes.length">{{ git.changes.length }}</span>
        </button>
        <div class="side-actions">
          <button
            v-if="section !== 'project'"
            title="Обновить обзор"
            aria-label="Обновить обзор"
            @click="refresh"
          >
            <IconRefresh aria-hidden="true" />
          </button>
          <button
            :class="{ selected: section === 'project' }"
            :aria-pressed="section === 'project'"
            title="Настройки проекта"
            aria-label="Настройки проекта"
            @click="section = 'project'"
          >
            <IconSettings aria-hidden="true" />
          </button>
        </div>
      </nav>
      <div v-show="section === 'files'" class="side-content">
        <FileTree
          :project-id="projectId"
          :selected="active?.path ?? ''"
          :revision="revision"
          @open="openFile($event)"
          @moved="entryMoved"
        />
      </div>
      <div v-show="section === 'search'" class="side-content search-panel">
        <form @submit.prevent="search">
          <input
            v-model="query"
            type="search"
            placeholder="Найти в проекте…"
            aria-label="Поиск по содержимому"
            maxlength="200"
          />
        </form>
        <p v-if="searching" class="notice" role="status">поиск…</p>
        <p v-if="searchError" class="notice error" role="alert">{{ searchError }}</p>
        <p v-if="searched" class="notice">
          {{
            hits.length
              ? `${hits.length} совпадений${truncated ? " · показаны первые 200" : ""}`
              : "Совпадений нет"
          }}
        </p>
        <button
          v-for="(hit, index) in hits"
          :key="index"
          class="result"
          :title="`${hit.path}:${hit.line}`"
          @click="openFile(hit.path, hit.line, hit.column)"
        >
          <span class="result-path">{{ hit.path }}:{{ hit.line }}</span
          ><span class="snippet">{{ hit.text }}</span>
        </button>
      </div>
      <div v-show="section === 'git'" class="side-content">
        <p v-if="gitLoading" class="notice" role="status">загрузка Git…</p>
        <p v-if="gitError" class="notice error" role="alert">{{ gitError }}</p>
        <p v-else-if="!gitLoading && !git.available" class="notice">
          В этой папке нет Git-репозитория.
        </p>
        <p v-else-if="!gitLoading && !git.changes.length" class="notice">Нет изменений.</p>
        <template
          v-for="group in [
            { label: 'Подготовленные', rows: stagedChanges, staged: true },
            { label: 'Рабочие файлы', rows: workingChanges, staged: false },
          ]"
          :key="group.label"
        >
          <h3 v-if="group.rows.length">
            {{ group.label }} <span>{{ group.rows.length }}</span>
          </h3>
          <GitChangesTree
            v-if="group.rows.length"
            :key="`${projectId}:${group.staged}`"
            :changes="group.rows"
            :staged="group.staged"
            :selected="active?.staged === group.staged ? active.path : ''"
            @open="openFile($event, undefined, undefined, group.staged)"
          />
        </template>
      </div>
      <div v-if="section === 'project'" class="side-content project-settings">
        <slot name="project" />
      </div>
    </aside>
    <div
      class="resize-handle tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина дерева файлов"
      tabindex="0"
      @pointerdown="resizePane($event, 'tree')"
      @keydown="resizeKey($event, 'tree')"
    />
    <section class="editor-pane" aria-label="Файлы и изменения">
      <WorkspaceTabs
        v-if="tabs.length"
        :tabs="fileTabs"
        :active-id="activeKey"
        label="Открытые файлы"
        @select="selectTab"
        @close="closeTab"
        @reorder="reorderTabs"
      />
      <div v-if="active" class="breadcrumb">
        <span>{{ active.path }}</span
        ><span v-if="active.original !== undefined">{{
          active.staged ? "HEAD → index" : "index → рабочий файл"
        }}</span>
      </div>
      <p v-if="fileError" class="file-error" role="alert">{{ fileError }}</p>
      <div class="editor-body" :aria-busy="loading">
        <p v-if="loading" class="loading" role="status">читаю файл…</p>
        <ArchiveViewer v-if="active?.archive" :key="active.key" :archive="active.archive" />
        <MarkdownViewer
          v-else-if="active && isMarkdown(active)"
          :key="active.key"
          :project-id="projectId"
          :path="active.path"
          :content="active.draft ?? active.content"
          :mode="active.markdownMode ?? 'preview'"
          :dirty="isDirty(active)"
          :saving="!!active.saving"
          :error="active.saveError"
          :line="active.line"
          :column="active.column"
          @change="active.draft = $event"
          @mode="active.markdownMode = $event"
          @save="saveMarkdown"
          @open="openFile($event)"
        />
        <CodeViewer
          v-else-if="active"
          :path="active.path"
          :content="active.content"
          :original="active.original"
          :line="active.line"
          :column="active.column"
        />
      </div>
    </section>
    <div
      class="resize-handle agent-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина терминала"
      tabindex="0"
      @pointerdown="resizePane($event, 'agent')"
      @keydown="resizeKey($event, 'agent')"
    />
    <aside class="agent-pane" aria-label="Агент и терминал">
      <TerminalPane :key="projectId" :project-id="projectId" embedded>
        <template #actions><slot name="terminal-actions" /></template>
        <template #status><slot name="terminal-status" /></template>
      </TerminalPane>
    </aside>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns:
    var(--tree-width, clamp(200px, 19vw, 280px)) 4px minmax(260px, 1fr)
    4px var(--agent-width, clamp(370px, 34vw, 680px));
  border: 1px solid var(--line);
  border-radius: 5px;
  height: calc(100dvh - 84px);
  min-height: 440px;
  overflow: hidden;
}
.sidebar,
.agent-pane,
.editor-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.resize-handle {
  cursor: col-resize;
  background: var(--line);
  touch-action: none;
}
.resize-handle:hover,
.resize-handle:focus-visible {
  background: var(--focus);
  outline: none;
}
.sidebar {
  background: #141412;
  border-right: 1px solid var(--line);
}
.agent-pane {
  border-left: 1px solid var(--line);
  background: var(--bg-2);
}
.side-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  gap: 14px;
  padding: 0 12px;
}
.side-tabs button {
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}
.side-tabs button.selected {
  color: var(--text);
  border-color: var(--focus);
}
.side-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.side-actions button {
  display: grid;
  place-items: center;
}
.side-actions svg {
  width: 14px;
  height: 14px;
}
.project-settings {
  padding: 8px 12px 16px;
}
.side-tabs span {
  color: var(--run);
  font: 10px var(--mono);
}
.side-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.search-panel form {
  margin: 2px 10px 8px;
}
.search-panel input {
  font-size: 12px;
}
.notice {
  padding: 0 12px;
  color: var(--muted);
  font-size: 12px;
}
.error {
  color: var(--err);
}
.result {
  display: block;
  padding: 8px 12px;
  width: 100%;
  text-align: left;
  border-bottom: 1px solid #21211e;
}
.result:hover {
  background: #242420;
}
.result-path {
  display: block;
  font-size: 11px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.snippet {
  display: block;
  font: 11px var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 4px;
}
h3 {
  padding: 10px 12px 4px;
  margin: 0;
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
h3 span {
  margin-left: 6px;
  color: var(--faint);
}
.breadcrumb {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  font: 10px var(--mono);
  color: var(--muted);
  border-bottom: 1px solid #20201c;
}
.breadcrumb span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.breadcrumb span:last-child {
  flex-shrink: 0;
  color: var(--faint);
}
.editor-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.file-error {
  margin: 0;
  padding: 12px;
  color: var(--err);
  font-size: 12px;
  border-bottom: 1px solid var(--line);
}
.loading {
  position: absolute;
  top: 4px;
  right: 14px;
  z-index: 2;
  background: var(--bg-2);
  padding: 6px 12px;
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 1050px) {
  .workspace {
    grid-template-columns: 190px minmax(250px, 1fr);
    height: auto;
    min-height: 0;
  }
  .resize-handle {
    display: none;
  }
  .sidebar,
  .editor-pane {
    height: 65dvh;
    min-height: 400px;
  }
  .agent-pane {
    grid-column: 1 / -1;
    height: 450px;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
@media (max-width: 600px) {
  .workspace {
    grid-template-columns: 145px minmax(0, 1fr);
  }
  .side-tabs {
    gap: 8px;
    padding: 0 8px;
  }
  .side-tabs button {
    font-size: 11px;
  }
  .breadcrumb span:last-child {
    display: none;
  }
}
</style>
