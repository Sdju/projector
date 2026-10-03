<script setup lang="ts">
import { ref } from "vue";
import { FileTree } from "../modules/tree/index.ts";
import {
  GitPanel,
  type GitBranchesState,
  type GitHistoryState,
  type GitOverviewState,
} from "../modules/git/index.ts";
import type { useGitChangeSync } from "../lib/git-change-sync.ts";
import type { useOpenFiles } from "../lib/open-files.ts";
import type { OpenFile } from "../open-file.ts";
import SearchPanel from "./SearchPanel.vue";
import SidebarTabs, { type SidebarSection } from "./SidebarTabs.vue";

/** Боковая панель проекта: дерево файлов, поиск и Git с переключателем разделов. */
const props = defineProps<{
  projectId: string;
  hidden: boolean;
  active?: OpenFile;
  revision: number;
  overview: GitOverviewState;
  history: GitHistoryState;
  branches: GitBranchesState;
  files: ReturnType<typeof useOpenFiles>;
  gitSync: ReturnType<typeof useGitChangeSync>;
}>();
const section = defineModel<SidebarSection>("section", { required: true });
const emit = defineEmits<{
  command: [id: string];
  refresh: [];
  settings: [];
  changed: [];
  deleted: [path: string];
  moved: [source: string, destination: string];
}>();
const fileTree = ref<InstanceType<typeof FileTree>>();
const searchPanel = ref<InstanceType<typeof SearchPanel>>();
const gitPanel = ref<InstanceType<typeof GitPanel>>();
const { openFile, openCommit, openCommitFile, prepareEntryChange } = props.files;

defineExpose({
  reveal: (path: string) => fileTree.value?.reveal(path),
  refreshSearch: () => searchPanel.value?.refresh(),
  search: () => searchPanel.value?.search(),
});
</script>

<template>
  <aside v-show="!hidden" class="sidebar" aria-label="Обзор проекта">
    <SidebarTabs
      v-model:section="section"
      :git-count="overview.git.value.changes.length"
      :settings-active="active?.virtual === 'project'"
      @command="emit('command', $event)"
      @refresh="section === 'git' ? gitPanel?.refresh() : emit('refresh')"
      @settings="emit('settings')"
    />
    <div v-show="section === 'files'" class="side-content">
      <FileTree
        ref="fileTree"
        :before-change="prepareEntryChange"
        :project-id="projectId"
        :selected="active?.path ?? ''"
        :revision="revision"
        :git-changes="overview.git.value.changes"
        @changed="emit('changed')"
        @deleted="emit('deleted', $event)"
        @open="(path, pinned) => openFile(path, undefined, undefined, undefined, { preview: !pinned })"
        @moved="(source, destination) => emit('moved', source, destination)"
      />
    </div>
    <SearchPanel
      v-show="section === 'search'"
      ref="searchPanel"
      :project-id="projectId"
      @open="openFile"
    />
    <GitPanel
      v-show="section === 'git'"
      ref="gitPanel"
      :project-id="projectId"
      :overview="overview"
      :history="history"
      :branches="branches"
      :selected="active ? { path: active.path, staged: active.staged } : undefined"
      :prepare="gitSync.prepare"
      :invalidate="files.invalidate"
      :applied="gitSync.applied"
      @open="(path, staged, pinned) => openFile(path, undefined, undefined, staged, { preview: !pinned })"
      @open-commit="openCommit"
      @open-commit-diff="(hash, path, pinned) => openCommitFile(hash, path, !pinned)"
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
@media (max-width: 1050px) {
  .sidebar {
    grid-row: 3;
    border-right: 1px solid var(--line);
    height: 65dvh;
    min-height: 400px;
  }
}
@media (max-width: 600px) {
  .sidebar {
    grid-column: 1;
    grid-row: 3;
    height: 260px;
    min-height: 0;
  }
}
</style>
