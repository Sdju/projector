<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  workspaceProfile,
  profileCapabilities,
  type WorkspaceCapability,
} from "../../workspace-api/index.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import WorkbenchToolbar from "./WorkbenchToolbar.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import WorkspaceSidebar from "./WorkspaceSidebar.vue";
import type { SidebarSection } from "./SidebarTabs.vue";
import { useGitOverview, useGitHistory, useGitBranches } from "../modules/git/index.ts";
import { useGitChangeSync } from "../lib/git-change-sync.ts";
import { useSidebarResize } from "../lib/sidebar-resize.ts";
import { useOpenFiles } from "../lib/open-files.ts";
import { useWorkbenchLayout } from "../lib/workbench-layout.ts";
import { registerEditorCommands } from "../lib/editor-commands.ts";
import { useWorkspaceSession } from "../lib/workspace-session.ts";
import WorkbenchDock from "./WorkbenchDock.vue";
import StatusBar from "./StatusBar.vue";
import type { DockTarget } from "../../dock/index.ts";
import { type OpenFile } from "../open-file.ts";
import { createPanelHosts } from "../panel-hosts.ts";
import { TerminalCloseDialog } from "../../terminal/index.ts";
import { useDocker } from "../../docker/index.ts";
import { virtualTabs } from "../lib/virtual-tabs.ts";
import { useWorkspaceRefresh } from "../lib/workspace-refresh.ts";
import { useMobileSurfaces, registerMobileCommands } from "../lib/mobile-surfaces.ts";
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
}>();
const profile = workspaceProfile(props.projectId);
const capabilities = profileCapabilities(profile);
const workspaceElement = ref<HTMLElement>();
const sidebarHidden = ref(false);
const { mobile, mobileSurface, mobileActionsOpen, mobileSidebarOpen, sidebarInvisible, showSidebar } =
  useMobileSurfaces(sidebarHidden);
const { treeWidth, sizes, resizeTree, resizeTreeKey } = useSidebarResize(workspaceElement);
const sidebar = ref<InstanceType<typeof WorkspaceSidebar>>();
const editorCommands = useCommandScope(`editor:${props.projectId}`, () => ({
  surface: "editor",
  projectId: props.projectId,
}));
const registerEditor = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: WorkspaceCapability,
) =>
  editorCommands.scope.registerCommand({
    id,
    title,
    run,
    enabled: (args) => (!requires || capabilities[requires]) && enabled(args),
  });
function treeChanged() {
  revision.value++;
  void loadGit();
}
function entryDeleted(path: string) {
  files.invalidate();
  tabs.value = tabs.value.filter(
    (tab) => tab.virtual || tab.commit || (tab.path !== path && !tab.path.startsWith(path + "/")),
  );
  revision.value++;
  void loadGit();
  sidebar.value?.refreshSearch();
}
const overview = useGitOverview(() => props.projectId);
const history = useGitHistory(() => props.projectId);
const branches = useGitBranches(() => props.projectId);
const { gutterRevision } = overview;
const loadGit = () => (capabilities.git ? overview.load() : Promise.resolve());
const section = ref<SidebarSection>("files");
const revision = ref(0);
const isDirty = (file: OpenFile) =>
  file.virtual === "project"
    ? !!props.projectSettingsDirty
    : !file.virtual && file.draft !== undefined && file.draft !== file.content;
const tabs = ref<OpenFile[]>([]);
/** Куда поместить следующую открытую вкладку: заполняется при перетаскивании файла на блок. */
const pending: { target?: DockTarget } = {};
const workbench = useWorkbenchLayout({
  projectId: () => props.projectId,
  capabilities,
  layout: profile.layout,
  tabs,
  pending,
  isDirty,
  virtualTitle: (kind) => virtualTabs[kind].title,
  selectTab: (key) => files.selectTab(key),
  closeTab: (key) => files.closeTab(key),
  closeManyTabs: (ids) => files.closeManyTabs(ids),
  showSidebar,
  register: registerEditor,
});
const {
  layout,
  restoringSession,
  terminals,
  fileOf,
  activeKey,
  revealPanel,
  hiddenGroups,
  groupLabel,
  showGroup,
} = workbench;
const files = useOpenFiles({
  projectId: () => props.projectId,
  tabs,
  active: () => active.value,
  activeKey: () => activeKey.value,
  reveal: (id) => revealPanel(id),
  isDirty,
  saved: () => void loadGit(),
  beforeCloseProjectSettings: () => props.beforeCloseProjectSettings?.(),
  pending,
});
const {
  fileError,
  loading,
  openFile,
  selectTab,
  saveFile,
  toggleMarkdownSource,
} = files;
const { tabActions, editorKeydown, editorFocus } = registerEditorCommands({
  editorCommands,
  register: registerEditor,
  tabs,
  active: () => active.value,
  activeKey: () => activeKey.value,
  fileOf,
  saveFile,
  openFile,
  selectTab,
  toggleMarkdownSource,
  revealInTree: (path) => {
    section.value = "files";
    showSidebar();
    sidebar.value?.reveal(path);
  },
  saveProjectSettings: () => props.saveProjectSettings?.(),
});
const docker = useDocker(props.projectId, {
  enabled: capabilities.docker,
  sidebar: () => { section.value = "docker"; showSidebar(); },
  open: () => {
    const { key, path } = virtualTabs.docker;
    if (!tabs.value.some((tab) => tab.key === key)) tabs.value.push({ key, path, virtual: "docker", content: "" });
    selectTab(key);
  },
  terminal: async (session) => { await terminals.refresh(); revealPanel(`terminal:${session.id}`); },
});
function openProjectSettings() {
  const { key, path } = virtualTabs.project;
  if (!tabs.value.some((tab) => tab.key === key))
    tabs.value.push({ key, path, virtual: "project", content: "" });
  selectTab(key);
}
const panelHosts = createPanelHosts();
const keepAlive = new Set([virtualTabs.agent.key, virtualTabs.project.key]);
registerEditor(
  "ide.workbench.sidebar.toggle",
  "Показать или скрыть боковую панель",
  () => {
    if (mobile.value) mobileSidebarOpen.value = !mobileSidebarOpen.value;
    else sidebarHidden.value = !sidebarHidden.value;
  },
  () => true,
);
useWorkspaceSession({
  persist: capabilities.persist,
  initialLayout: workbench.initialLayout,
  projectId: () => props.projectId,
  tabs,
  layout,
  restoringSession,
  activeKey,
  section,
  treeWidth,
  sidebarHidden,
  virtualTab: (kind) => virtualTabs[kind],
  openFile,
  fileGeneration: files.generation,
  openProjectSettings,
  resetFiles: files.reset,
  openCommit: (hash) => files.openCommit(hash),
  openCommitFile: files.openCommitFile,
  resetGit: () => {
    overview.reset();
    history.reset();
    branches.reset();
  },
  reloadGit: () => void loadGit(),
});
registerMobileCommands({
  editorCommands,
  capabilities,
  surface: mobileSurface,
  actionsOpen: mobileActionsOpen,
  mobile,
  activeKey,
  focusedPanel: () => workbench.focusedGroup.value?.active,
  restoringSession,
});
const active = computed(() => tabs.value.find((file) => file.key === activeKey.value));
const gitSync = useGitChangeSync({
  projectId: () => props.projectId,
  tabs,
  active: () => active.value,
  files,
  bumpRevision: () => revision.value++,
  refreshSearch: () => sidebar.value?.refreshSearch(),
});
watch(section, (value) => {
  if (value === "git") void loadGit();
});
const { refresh, entryMoved } = useWorkspaceRefresh({
  projectId: () => props.projectId,
  capabilities,
  tabs,
  layout,
  files,
  active: () => active.value,
  activeKey: () => activeKey.value,
  revision,
  section,
  searchPanel: () => sidebar.value,
  loadGit,
});
defineExpose({ openFile, refresh });
onBeforeUnmount(() => {
  overview.cancel();
});
</script>

<template>
  <div
    ref="workspaceElement"
    class="workspace"
    :class="{ 'sidebar-hidden': sidebarInvisible }"
    :style="sizes"
  >
    <nav v-if="mobile" class="mobile-surfaces" aria-label="Поверхности проекта">
      <UiButton v-for="entry in [{ id: 'files', title: 'Файлы' }, { id: 'editor', title: 'Редактор' }, ...(capabilities.terminals ? [{ id: 'terminal', title: 'Терминалы' }] : [])]"
        :key="entry.id" :active="mobileSurface === entry.id" :aria-pressed="mobileSurface === entry.id"
        @click="editorCommands.run('ide.workbench.mobile.surface.show', { surface: entry.id })">{{ entry.title }}</UiButton>
      <UiButton :active="mobileActionsOpen" :aria-expanded="mobileActionsOpen" aria-label="Действия проекта"
        @click="editorCommands.run('ide.workbench.mobile.actions.toggle')">···</UiButton>
    </nav>
    <div v-if="!mobile || mobileActionsOpen" class="toolbar-host" :class="{ 'mobile-actions': mobile }">
    <WorkbenchToolbar
      :capabilities="capabilities"
      :sidebar-hidden="sidebarInvisible"
      :terminals-busy="terminals.busy.value"
      :terminals-error="terminals.error.value"
      :hidden-groups="hiddenGroups.map((group) => ({ id: group.id, label: groupLabel(group) }))"
      @command="(id, args) => { if (mobile) mobileActionsOpen = false; editorCommands.run(id, args); }"
      @show-group="showGroup"
    >
      <template #terminal-actions><slot name="terminal-actions" /></template>
      <template #terminal-status><slot name="terminal-status" /></template>
    </WorkbenchToolbar>
    </div>
    <p v-if="fileError" class="file-error" role="alert">{{ fileError }}</p>
    <Transition name="mobile-left">
    <WorkspaceSidebar
      ref="sidebar"
      v-model:section="section"
      :project-id="projectId"
      :capabilities="capabilities"
      :hidden="sidebarInvisible"
      :active="active"
      :revision="revision"
      :overview="overview"
      :history="history"
      :branches="branches"
      :files="files"
      :git-sync="gitSync"
      @command="($event.startsWith('ide.docker.') ? docker.commands : editorCommands).run($event)"
      @navigate="mobileSidebarOpen = false"
      @refresh="refresh"
      @settings="openProjectSettings"
      @changed="treeChanged"
      @deleted="entryDeleted"
      @moved="entryMoved"
    />
    </Transition>
    <div
      v-show="!sidebarInvisible"
      class="resize-handle tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина дерева файлов"
      tabindex="0"
      @pointerdown="resizeTree"
      @keydown="resizeTreeKey"
    />
    <button
      v-if="mobile && mobileSidebarOpen"
      class="sidebar-backdrop"
      aria-label="Закрыть боковую панель"
      data-command="ide.workbench.sidebar.toggle"
      @click="editorCommands.run('ide.workbench.sidebar.toggle')"
    />
    <section
      class="dock-pane"
      :inert="mobile && mobileSidebarOpen"
      aria-label="Блоки редактора и терминалов"
      @focusin="editorFocus"
      @keydown.capture="editorKeydown"
    >
      <p v-if="loading" class="loading" role="status">читаю файл…</p>
      <WorkbenchDock
        :project-id="projectId"
        :workbench="workbench"
        :mobile="mobile"
        :mobile-surface="mobileSurface"
        :files="files"
        :tab-actions="tabActions"
        :panel-hosts="panelHosts"
        :keep-alive="keepAlive"
        :gutter-revision="gutterRevision"
        :tabs="tabs"
        :virtual-keys="{ agent: virtualTabs.agent.key, project: virtualTabs.project.key }"
      >
        <template #mobile-terminal-actions>
          <UiButton v-for="program in ['shell', 'codex', 'claude', 'opencode']" :key="program" size="sm"
            :disabled="terminals.busy.value" :aria-label="`Новый ${program}`"
            @click="editorCommands.run('ide.workbench.terminal.new', { program })">+ {{ program }}</UiButton>
        </template>
        <template #project><slot name="project" /></template>
      </WorkbenchDock>
    </section>
    <TerminalCloseDialog
      :session="terminals.pendingClose.value"
      :busy="terminals.busy.value"
      @cancel="terminals.cancelClose"
      @confirm="terminals.confirmClose"
    />
    <StatusBar class="workspace-status" />
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: var(--tree-width, clamp(200px, 19vw, 280px)) 1px minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  height: calc(100dvh - 84px);
  min-height: 440px;
  overflow: hidden;
}
.workspace.sidebar-hidden {
  grid-template-columns: 0 0 minmax(0, 1fr);
}
.tree-resize {
  grid-column: 2;
  grid-row: 3;
}
.dock-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  grid-column: 3;
  grid-row: 3;
}
/* Видимая линия 1px, зона захвата шире за счёт ::before */
.resize-handle {
  position: relative;
  z-index: 1;
  cursor: col-resize;
  background: var(--line);
  touch-action: none;
  transition: background var(--t-fast);
}
.resize-handle::before {
  content: "";
  position: absolute;
  inset: 0 -4px;
}
.resize-handle:hover,
.resize-handle:focus-visible,
.resize-handle:active {
  background: var(--line-strong);
}
.resize-handle:focus-visible {
  outline: none;
  background: var(--focus);
}
.file-error {
  grid-column: 1 / -1;
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
  border-bottom: 1px solid var(--line);
}
.loading {
  position: absolute;
  top: 4px;
  right: 14px;
  z-index: var(--z-sticky);
  background: var(--bg-2);
  padding: 6px var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
@media (max-width: 1050px) and (min-width: 701px) {
  .dock-pane {
    overflow: auto;
  }
  .workspace {
    grid-template-columns: 220px 1px minmax(0, 1fr);
  }
  .workspace.sidebar-hidden {
    grid-template-columns: 0 0 minmax(0, 1fr);
  }
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .workspace,
  .workspace.sidebar-hidden {
    position: relative;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    height: 100%;
    min-height: 0;
    border-radius: 0;
    border-inline: 0;
  }
  .tree-resize {
    display: none;
  }
  .dock-pane {
    grid-column: 1;
    grid-row: 3;
    overflow: hidden;
  }
  .mobile-left-enter-active,
  .mobile-left-leave-active {
    transition: transform var(--t-base);
  }
  .mobile-left-enter-from,
  .mobile-left-leave-to {
    transform: translateX(-100%);
  }
  .sidebar-backdrop {
    grid-column: 1;
    grid-row: 3;
    z-index: 2;
    justify-self: end;
    width: calc(100% - min(340px, 90%));
    background: var(--overlay);
  }
}
.toolbar-host {
  grid-column: 1 / -1;
}
.workspace-status {
  grid-column: 1 / -1;
  grid-row: 4;
}
.mobile-surfaces {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: 40px;
  padding-inline: var(--sp-2);
  border-bottom: 1px solid var(--line);
  background: var(--bg-sunken);
}
.mobile-surfaces .btn {
  min-height: 36px;
  border-color: transparent;
  flex: 1;
}
.mobile-surfaces .btn:last-child {
  flex: none;
  width: 40px;
}
.mobile-actions {
  position: absolute;
  top: 40px;
  inset-inline: 0;
  z-index: var(--z-popover);
  background: var(--bg-2);
  box-shadow: var(--shadow-popover);
}
.mobile-actions :deep(.toolbar) {
  flex-wrap: wrap;
  padding: var(--sp-2);
}
</style>
