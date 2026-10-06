<script setup lang="ts">
import { computed, watch } from "vue";
import type { SidebarRegistry, WorkspaceCapabilities } from "../../workspace-api/index.ts";
import type { GitBranchesState, GitHistoryState, GitOverviewState } from "../modules/git/index.ts";
import type { useGitChangeSync } from "../lib/git-change-sync.ts";
import type { useOpenFiles } from "../lib/open-files.ts";
import type { OpenFile } from "../open-file.ts";
import { baseSidebarViews, type SidebarHost, type SidebarViews } from "../lib/sidebar-views.ts";
import SidebarTabs from "./SidebarTabs.vue";
import IconRefresh from "~icons/lucide/rotate-cw";

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
  command: [id: string];
  refresh: [];
  navigate: [];
  changed: [];
  deleted: [path: string];
  moved: [source: string, destination: string];
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
  command: (id) => emit("command", id),
  refreshWorkspace: () => emit("refresh"),
  changed: () => emit("changed"),
  deleted: (path) => emit("deleted", path),
  moved: (source, destination) => emit("moved", source, destination),
};
const items = computed(() =>
  props.sections
    .list()
    .filter((type) => views[type.id])
    .map((type) => ({
      id: type.id,
      title: type.title,
      icon: views[type.id].icon,
      command: type.command,
      badge: views[type.id].badge?.(host) ?? 0,
    })),
);
const setPanel = (id: string, panel: unknown) =>
  panel ? panels.set(id, panel as never) : panels.delete(id);
function refresh() {
  const view = views[section.value];
  if (view?.refresh) view.refresh(host, panels.get(section.value));
  else emit("refresh");
}
watch(section, (id) => views[id]?.activate?.(host));
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
  reveal: (path: string) => (panels.get("files")?.reveal as (path: string) => void)?.(path),
  refreshSearch: () => panels.get("search")?.refresh?.(),
  search: () => (panels.get("search")?.search as () => void | Promise<void>)?.(),
});
</script>

<template>
  <aside v-show="rail || !hidden" class="sidebar" :class="{ 'with-rail': rail }" aria-label="Обзор проекта">
    <SidebarTabs
      :section="section"
      :items="items"
      :vertical="rail"
      :collapsed="rail && hidden"
      @update:section="select"
      @command="emit('command', $event)"
    />
    <div v-show="!rail || !hidden" class="panel">
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
        :is="views[item.id].component"
        v-for="item in items"
        :key="item.id"
        v-show="section === item.id"
        :ref="(panel: unknown) => setPanel(item.id, panel)"
        v-bind="views[item.id].props(host, section === item.id)"
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
.panel-refresh svg {
  width: 13px;
  height: 13px;
}
.with-rail .panel:hover .panel-refresh,
.with-rail .panel:focus-within .panel-refresh {
  opacity: 1;
  pointer-events: auto;
}
.panel-refresh:hover {
  color: var(--text);
  background: var(--bg-4);
}
.side-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .sidebar {
    grid-column: 1;
    grid-row: 3;
    z-index: 3;
    width: min(340px, 90%);
    border-width: 0 1px 0 0;
    border-color: var(--line-strong);
    border-radius: 0;
    box-shadow: var(--shadow-popover);
  }
}
</style>
