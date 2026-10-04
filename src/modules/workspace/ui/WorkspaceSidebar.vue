<script setup lang="ts">
import { computed, watch } from "vue";
import type { SidebarRegistry, WorkspaceCapabilities } from "../../workspace-api/index.ts";
import type { GitBranchesState, GitHistoryState, GitOverviewState } from "../modules/git/index.ts";
import type { useGitChangeSync } from "../lib/git-change-sync.ts";
import type { useOpenFiles } from "../lib/open-files.ts";
import type { OpenFile } from "../open-file.ts";
import { baseSidebarViews, type SidebarHost, type SidebarViews } from "../lib/sidebar-views.ts";
import SidebarTabs from "./SidebarTabs.vue";

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
  openTab(id, params) {
    props.files.openTab(id, params);
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

defineExpose({
  reveal: (path: string) => (panels.get("files")?.reveal as (path: string) => void)?.(path),
  refreshSearch: () => panels.get("search")?.refresh?.(),
  search: () => (panels.get("search")?.search as () => void | Promise<void>)?.(),
});
</script>

<template>
  <aside v-show="!hidden" class="sidebar" aria-label="Обзор проекта">
    <SidebarTabs
      v-model:section="section"
      :items="items"
      :capabilities="capabilities"
      @command="emit('command', $event)"
      @refresh="refresh"
    />
    <component
      :is="views[item.id].component"
      v-for="item in items"
      :key="item.id"
      v-show="section === item.id"
      :ref="(panel: unknown) => setPanel(item.id, panel)"
      v-bind="views[item.id].props(host, section === item.id)"
    />
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
  background: var(--bg-sunken);
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
    border-right: 1px solid var(--line-strong);
    box-shadow: var(--shadow-popover);
  }
}
</style>
