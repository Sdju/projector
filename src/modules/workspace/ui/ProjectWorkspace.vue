<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  workspaceProfile,
  profileCapabilities,
  type WorkspaceCapability,
} from "../../workspace-api/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import WorkbenchToolbar from "./WorkbenchToolbar.vue";
import MobileSurfaces from "./MobileSurfaces.vue";
import WorkspaceSidebar from "./WorkspaceSidebar.vue";
import { useGitOverview, useGitHistory, useGitBranches } from "../modules/git/index.ts";
import { useGitChangeSync } from "../lib/git-change-sync.ts";
import { useSidebarResize } from "../lib/sidebar-resize.ts";
import { useOpenFiles } from "../lib/open-files.ts";
import { ensureTab } from "../lib/service-tabs.ts";
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
import { sidebarSections } from "../lib/sidebar-views.ts";
import { provideTabHost, useWorkspaceTabTypes, type TabViews } from "../lib/tab-views.ts";
import { useWorkspaceRefresh } from "../lib/workspace-refresh.ts";
import { useMobileSurfaces, registerMobileCommands } from "../lib/mobile-surfaces.ts";
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
  tabViews?: TabViews; // views of the kinds the embedding page owns
}>();
const profile = workspaceProfile(props.projectId);
const capabilities = profileCapabilities(profile);
const tabTypes = useWorkspaceTabTypes(profile, props.tabViews, {
  project: {
    dirty: () => !!props.projectSettingsDirty,
    beforeClose: () => props.beforeCloseProjectSettings?.(),
    save: () => props.saveProjectSettings?.(),
  },
});
const workspaceElement = ref<HTMLElement>();
const sidebarHidden = ref(false);
const { mobile, mobileSurface, mobileSidebarOpen, sidebarInvisible, showSidebar } =
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
  meta?: { description?: string; arguments?: Record<string, string> },
) =>
  editorCommands.scope.registerCommand({
    id,
    title,
    ...meta,
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
const section = ref("files");
const sections = sidebarSections(profile, capabilities);
const revision = ref(0);
const isDirty = (file: OpenFile) =>
  file.virtual
    ? !!tabTypes.behaviorOf(file.virtual)?.dirty?.()
    : file.draft !== undefined && file.draft !== file.content;
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
  tabTypes,
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
  layoutGroups,
  currentPreset,
  presetsAvailable,
} = workbench;
const files = useOpenFiles({
  projectId: () => props.projectId,
  tabs,
  active: () => active.value,
  activeKey: () => activeKey.value,
  reveal: (id) => revealPanel(id),
  isDirty,
  saved: () => void loadGit(),
  pending,
  tabTypes,
});
const { fileError, loading, openFile, openTab, saveFile, toggleMarkdownSource } = files;
provideTabHost({
  projectId: props.projectId,
  openFile: (path) => void openFile(path),
  openTab,
  openCommitDiff: (hash, path) => void files.openCommitFile(hash, path),
  run: (command, args) => editorCommands.run(command, args),
});
const { tabActions, editorKeydown, editorFocus } = registerEditorCommands({
  projectId: props.projectId,
  editorCommands,
  register: registerEditor,
  tabs,
  active: () => active.value,
  activeKey: () => activeKey.value,
  fileOf,
  saveFile,
  openFile,
  openTab,
  onOpenTab: () => (mobileSidebarOpen.value = false),
  toggleMarkdownSource,
  revealInTree: (path) => {
    section.value = "files";
    showSidebar();
    sidebar.value?.reveal(path);
  },
  tabTypes,
});
const docker = useDocker(props.projectId, {
  enabled: capabilities.docker,
  sidebar: () => {
    section.value = "docker";
    showSidebar();
  },
  open: () => openTab("docker"),
  terminal: async (session) => {
    await terminals.refresh();
    revealPanel(`terminal:${session.id}`);
  },
});
const panelHosts = createPanelHosts();
registerEditor(
  "ide.workbench.sidebar.refresh",
  "Обновить раздел боковой панели",
  () => sidebar.value?.refreshSection(),
  () => true,
);
registerEditor(
  "ide.workbench.section.show",
  "Открыть раздел боковой панели",
  (value) => {
    const id = commandArgs(value).section;
    if (typeof id !== "string" || !sections.has(id))
      throw new Error(
        `section: ${sections
          .list()
          .map((type) => type.id)
          .join(", ")}`,
      );
    section.value = id;
    showSidebar();
  },
  () => true,
  undefined,
  {
    description:
      "Переключает боковую панель на раздел проекта (файлы, поиск, Git и другие, если они есть у проекта) и показывает её.",
    arguments: { section: "Идентификатор раздела: files, search, git, docker, issues и т. д." },
  },
);
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
  sections,
  treeWidth,
  sidebarHidden,
  mobile,
  mobileSurface,
  terminals: capabilities.terminals,
  ensureTab: (id, params) => ensureTab(tabs, tabTypes, id, params),
  openFile,
  fileGeneration: files.generation,
  resetFiles: files.reset,
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
defineExpose({ openFile, refresh, openTab });
onBeforeUnmount(() => overview.cancel());
</script>

<template>
  <div
    ref="workspaceElement"
    class="workspace"
    :class="{ 'sidebar-hidden': sidebarInvisible }"
    :style="sizes"
  >
    <div class="toolbar-host">
      <Teleport to="#header-tools" defer>
        <WorkbenchToolbar
          :capabilities="capabilities"
          :mobile="mobile"
          :sidebar-hidden="sidebarInvisible"
          :terminals-busy="terminals.busy.value"
          :terminals-error="terminals.error.value"
          :layout-groups="layoutGroups"
          :preset="currentPreset"
          :presets-available="presetsAvailable"
          @command="(id, args) => editorCommands.run(id, args)"
        >
          <template #terminal-actions><slot name="terminal-actions" /></template>
          <template #terminal-status><slot name="terminal-status" /></template>
        </WorkbenchToolbar>
      </Teleport>
    </div>
    <p v-if="fileError" class="file-error" role="alert">{{ fileError }}</p>
    <Transition name="mobile-left">
      <WorkspaceSidebar
        ref="sidebar"
        v-model:section="section"
        :project-id="projectId"
        :capabilities="capabilities"
        :sections="sections"
        :hidden="sidebarInvisible"
        :rail="!mobile"
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
        :gutter-revision="gutterRevision"
        :tabs="tabs"
        :terminals-busy="terminals.busy.value"
        :agent="capabilities.agent"
        @command="(id, args) => editorCommands.run(id, args)"
      />
    </section>
    <MobileSurfaces
      v-if="mobile"
      :terminals="capabilities.terminals"
      :surface="mobileSurface"
      @command="(id, args) => editorCommands.run(id, args)"
    />
    <TerminalCloseDialog
      :session="terminals.pendingClose.value"
      :busy="terminals.busy.value"
      @cancel="terminals.cancelClose"
      @confirm="terminals.confirmClose"
    />
    <StatusBar v-if="!mobile" class="workspace-status" />
  </div>
</template>

<style scoped>
.workspace {
  --rail-w: 40px;
  display: grid;
  grid-template-columns: var(--tree-width, clamp(240px, 21vw, 320px)) var(--island-gap) minmax(
      0,
      1fr
    );
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
/* Панель свёрнута, полоса разделов остаётся */
.workspace.sidebar-hidden {
  grid-template-columns: calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr);
  column-gap: 0;
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
/* Зазор между островами и есть зона захвата; при наведении проступает тонкая линия */
.resize-handle {
  position: relative;
  z-index: 1;
  cursor: col-resize;
  touch-action: none;
}
.resize-handle::before {
  content: "";
  position: absolute;
  inset: 0 calc(var(--island-gap) / 2 - 1px);
  border-radius: var(--r-full);
  transition: background var(--t-fast);
}
.resize-handle:hover::before,
.resize-handle:active::before {
  background: var(--line-strong);
}
.resize-handle:focus-visible {
  outline: none;
}
.resize-handle:focus-visible::before {
  background: var(--focus);
}
.file-error {
  grid-column: 1 / -1;
  margin: 0 0 var(--island-gap);
  padding: var(--sp-2) var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg);
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
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr);
  }
  .workspace.sidebar-hidden {
    grid-template-columns: calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr);
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
    padding: 0;
    background: none;
    border-radius: 0;
  }
  .tree-resize {
    display: none;
  }
  .dock-pane {
    grid-column: 1;
    grid-row: 3;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--bg);
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
    display: none;
  }
}
.toolbar-host {
  grid-column: 1 / -1;
}
/* Полоса действий вынесена в шапку (Teleport), здесь остаётся только якорь */
.toolbar-host {
  display: none;
}
.workspace-status {
  grid-column: 1 / -1;
  grid-row: 4;
  margin-top: var(--island-gap);
}
</style>
