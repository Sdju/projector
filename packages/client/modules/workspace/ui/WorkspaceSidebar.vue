<script setup lang="ts">
import { computed, watch } from "vue";
import type { SidebarRegistry, WorkspaceCapabilities } from "../../workspace-api/index.ts";
import type { GitBranchesState, GitHistoryState, GitOverviewState } from "../modules/git/index.ts";
import type { useGitChangeSync } from "../lib/git-change-sync.ts";
import type { useOpenFiles } from "../lib/open-files.ts";
import type { OpenFile } from "../open-file.ts";
import type { FileScope } from "@projector-ai/core/modules/workspace/index.ts";
import { baseSidebarViews, type SidebarHost, type SidebarViews } from "../lib/sidebar-views.ts";
import SidebarTabs from "./SidebarTabs.vue";
import IconRefresh from "~icons/lucide/rotate-cw";
import IconX from "~icons/lucide/x";

/** Боковая панель проекта: переключатель разделов и панель выбранного раздела. */
const props = defineProps<{
  projectId: string;
  capabilities: Readonly<WorkspaceCapabilities>;
  sections: SidebarRegistry;
  hidden: boolean;
  active?: OpenFile;
  revision: number;
  overview: GitOverviewState;
  history: GitHistoryState;
  branches: GitBranchesState;
  files: ReturnType<typeof useOpenFiles>;
  gitSync: ReturnType<typeof useGitChangeSync>;
  /** Panels of the sections the embedding page owns. */
  views?: SidebarViews;
  /** Разделы — вертикальная полоса-остров слева; иначе вкладки сверху панели (мобильный вид). */
  rail?: boolean;
}>();
const section = defineModel<string>("section", { required: true });
const emit = defineEmits<{
  command: [id: string, args?: unknown];
  refresh: [];
  navigate: [];
  changed: [];
  deleted: [path: string];
  moved: [source: string, destination: string];
  openCommitTree: [hash: string];
  openSearch: [scope: FileScope];
}>();
const views = { ...baseSidebarViews, ...props.views };
const panels = new Map<string, { refresh?: () => unknown; [name: string]: unknown }>();
const host: SidebarHost = {
  get projectId() {
    return props.projectId;
  },
  get active() {
    return props.active;
  },
  get revision() {
    return props.revision;
  },
  get overview() {
    return props.overview;
  },
  get history() {
    return props.history;
  },
  get branches() {
    return props.branches;
  },
  get files() {
    return props.files;
  },
  get gitSync() {
    return props.gitSync;
  },
  openFile(...args) {
    const result = props.files.openFile(...args);
    emit("navigate");
    return result;
  },
  openTab(id, params, options) {
    props.files.openTab(id, params, options);
    emit("navigate");
  },
  openCommitTree: (hash) => emit("openCommitTree", hash),
  openSearch: (scope) => emit("openSearch", scope),
  openPullFile: (number, path, head, pinned) =>
    props.files.openPullFile(number, path, head, !pinned),
  command: (id, args) => emit("command", id, args),
  refreshWorkspace: () => emit("refresh"),
  changed: () => emit("changed"),
  deleted: (path) => emit("deleted", path),
  moved: (source, destination) => emit("moved", source, destination),
};
const items = computed(() => {
  const result: Array<{
    id: string;
    title: string;
    icon: SidebarViews[string]["icon"];
    command?: string;
    badge: number;
    group?: string;
    kind: string;
    closable?: boolean;
  }> = [];
  for (const type of props.sections.list()) {
    const kind = type.kind ?? type.id;
    const view = views[kind];
    if (!view) continue;
    result.push({
      id: type.id,
      title: type.title,
      icon: view.icon,
      command: type.command,
      badge: view.badge?.(host) ?? 0,
      group: type.group && props.sections.has(type.group) ? type.group : undefined,
      kind,
      closable: type.closable,
    });
  }
  return result;
});
const viewOf = (id: string) => {
  const type = props.sections.get(id);
  return views[type?.kind ?? id];
};
const activeType = computed(() => props.sections.get(section.value));
const activeView = computed(() => {
  const type = activeType.value;
  return type ? views[type.kind ?? type.id] : undefined;
});
const setPanel = (id: string, panel: unknown) =>
  panel ? panels.set(id, panel as never) : panels.delete(id);
function refresh() {
  const view = viewOf(section.value);
  if (view?.refresh) view.refresh(host, panels.get(section.value));
  else emit("refresh");
}
watch(section, (id) => viewOf(id)?.activate?.(host));
/** Как в WebStorm: клик по активному разделу сворачивает панель, клик при свёрнутой — раскрывает. */
function select(id: string) {
  if (!props.rail) {
    section.value = id;
    return;
  }
  if (props.hidden || section.value === id) emit("command", "ide.workbench.sidebar.toggle");
  section.value = id;
}

defineExpose({
  refreshSection: refresh,
  reveal: (path: string, id = "files") =>
    (panels.get(id)?.reveal as (path: string) => void)?.(path),
  refreshSearch: () => panels.get("search")?.refresh?.(),
  search: () => (panels.get("search")?.search as () => void | Promise<void>)?.(),
});
</script>

<template>
  <aside
    v-show="rail || !hidden"
    class="sidebar"
    :class="{ 'with-rail': rail }"
    aria-label="Обзор проекта"
  >
    <SidebarTabs
      :section="section"
      :items="items"
      :vertical="rail"
      :collapsed="rail && hidden"
      @update:section="select"
      @command="(id, args) => emit('command', id, args)"
    />
    <div v-show="!rail || !hidden" class="panel">
      <div v-if="activeType?.closable" class="panel-head">
        <component
          :is="activeView?.icon"
          v-if="activeView"
          class="panel-head-icon"
          aria-hidden="true"
        />
        <span class="panel-head-text">
          <span v-if="rail || !activeType.source" class="panel-head-title">{{
            activeType.title
          }}</span>
          <span v-if="activeType.source" class="panel-head-source">{{ activeType.source }}</span>
        </span>
        <button
          v-if="!rail"
          class="panel-head-close"
          :title="`Закрыть «${activeType.title}»`"
          :aria-label="`Закрыть «${activeType.title}»`"
          data-command="ide.workbench.section.close"
          @click="emit('command', 'ide.workbench.section.close', { section })"
        >
          <IconX aria-hidden="true" />
        </button>
      </div>
      <button
        v-if="rail && activeType?.closable"
        class="panel-close"
        title="Закрыть раздел"
        aria-label="Закрыть раздел"
        data-command="ide.workbench.section.close"
        @click="emit('command', 'ide.workbench.section.close', { section })"
      >
        <IconX aria-hidden="true" />
      </button>
      <button
        v-if="rail"
        class="panel-refresh"
        title="Обновить раздел"
        aria-label="Обновить раздел"
        data-command="ide.workbench.sidebar.refresh"
        @click="emit('command', 'ide.workbench.sidebar.refresh')"
      >
        <IconRefresh aria-hidden="true" />
      </button>
      <component
        :is="views[item.kind].component"
        v-for="item in items"
        :key="item.id"
        v-show="section === item.id"
        :ref="(panel: unknown) => setPanel(item.id, panel)"
        v-bind="views[item.kind].props(host, section === item.id, props.sections.get(item.id))"
      />
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  grid-column: 1;
  grid-row: 3;
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg);
}
/* Рядом с полосой разделов: полоса — отдельный остров, панель — второй */
.sidebar.with-rail {
  flex-direction: row;
  gap: var(--island-gap);
  overflow: visible;
  border: 0;
  background: none;
}
.panel {
  display: contents;
}
.with-rail .panel {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg);
}
/* Источник временного раздела: не даёт перепутать снимок с рабочим деревом */
.panel-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
  min-height: 40px;
  padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.with-rail .panel-head {
  padding-right: calc(var(--sp-3) + 56px);
}
.panel-head-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--muted);
}
.panel-head-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.panel-head-title,
.panel-head-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-head-title {
  color: var(--text);
  font: 600 var(--fs-xs) var(--sans);
}
.panel-head-source {
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
}
.panel-head-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  margin-left: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--muted);
}
.panel-head-close:hover {
  color: var(--text);
  background: var(--bg-4);
}
.panel-head-close svg {
  width: 14px;
  height: 14px;
}
/* Как в VS Code: кнопка обновления скрыта и проступает в правом верхнем углу при наведении на остров */
.panel-refresh {
  position: absolute;
  top: var(--sp-1);
  right: var(--sp-3);
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--muted);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--t-fast);
}
.panel-close {
  position: absolute;
  top: var(--sp-1);
  right: calc(var(--sp-3) + 28px);
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--muted);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--t-fast);
}
.panel-refresh svg,
.panel-close svg {
  width: 13px;
  height: 13px;
}
.with-rail .panel:hover .panel-refresh,
.with-rail .panel:focus-within .panel-refresh,
.with-rail .panel:hover .panel-close,
.with-rail .panel:focus-within .panel-close {
  opacity: 1;
  pointer-events: auto;
}
.panel-refresh:hover,
.panel-close:hover {
  color: var(--text);
  background: var(--bg-4);
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .sidebar {
    grid-column: 1;
    grid-row: 3;
    z-index: 3;
    width: 100%;
  }
}
</style>
