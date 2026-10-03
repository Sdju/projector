<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { relocatedPath } from "../../../../core/modules/workspace/index.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import WorkbenchToolbar from "./WorkbenchToolbar.vue";
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
import { replacePanel, type DockTarget } from "../../dock/index.ts";
import { type OpenFile } from "../open-file.ts";
import { createPanelHosts } from "../panel-hosts.ts";
import { TerminalCloseDialog } from "../../terminal/index.ts";
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
}>();
const workspaceElement = ref<HTMLElement>();
const sidebarHidden = ref(false);
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
) => editorCommands.scope.registerCommand({ id, title, run, enabled });
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
const { gutterRevision, load: loadGit } = overview;
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
  tabs,
  pending,
  isDirty,
  virtualTitle: (kind) => virtualTabs[kind].title,
  selectTab: (key) => files.selectTab(key),
  closeTab: (key) => files.closeTab(key),
  closeManyTabs: (ids) => files.closeManyTabs(ids),
  showSidebar: () => {
    sidebarHidden.value = false;
  },
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
  openBrowserFile,
  closeTab,
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
    sidebarHidden.value = false;
    sidebar.value?.reveal(path);
  },
  saveProjectSettings: () => props.saveProjectSettings?.(),
});
const virtualTabs = {
  keybindings: {
    key: "settings:keybindings",
    path: "Горячие клавиши",
    title: "Настройки горячих клавиш",
  },
  agent: { key: "agent:chat", path: "Агент", title: "Чат с агентом Projector" },
  project: { key: "settings:project", path: "Настройки проекта", title: "Настройки проекта" },
  network: { key: "network:info", path: "Локальная сеть", title: "Доступ по локальной сети" },
};
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
    sidebarHidden.value = !sidebarHidden.value;
  },
  () => true,
);
useWorkspaceSession({
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
async function refresh() {
  revision.value++;
  await loadGit();
  if (section.value === "search") await sidebar.value?.search();
  if (active.value?.virtual || active.value?.commit) return;
  if (active.value?.localFile) void openBrowserFile(active.value.localFile, true);
  else if (active.value)
    void openFile(
      active.value.path,
      active.value.line,
      active.value.column,
      active.value.staged,
      { reload: true, external: !!active.value.external },
    );
}
function entryMoved(source: string, destination: string) {
  files.invalidate();
  for (const tab of [...tabs.value]) {
    if (tab.virtual || tab.commit) continue;
    const path = relocatedPath(tab.path, source, destination);
    if (path === tab.path) continue;
    if (tab.staged !== undefined) {
      closeTab(tab.key);
      continue;
    }
    const key = `${path}:file`;
    layout.value = replacePanel(layout.value, tab.key, key);
    tab.path = path;
    tab.key = key;
  }
  revision.value++;
  void loadGit();
  sidebar.value?.refreshSearch();
}
onBeforeUnmount(() => {
  overview.cancel();
});
</script>

<template>
  <div
    ref="workspaceElement"
    class="workspace"
    :class="{ 'sidebar-hidden': sidebarHidden }"
    :style="sizes"
  >
    <WorkbenchToolbar
      :sidebar-hidden="sidebarHidden"
      :terminals-busy="terminals.busy.value"
      :terminals-error="terminals.error.value"
      :hidden-groups="hiddenGroups.map((group) => ({ id: group.id, label: groupLabel(group) }))"
      @command="(id, args) => editorCommands.run(id, args)"
      @show-group="showGroup"
    >
      <template #terminal-actions><slot name="terminal-actions" /></template>
      <template #terminal-status><slot name="terminal-status" /></template>
    </WorkbenchToolbar>
    <p v-if="fileError" class="file-error" role="alert">{{ fileError }}</p>
    <WorkspaceSidebar
      ref="sidebar"
      v-model:section="section"
      :project-id="projectId"
      :hidden="sidebarHidden"
      :active="active"
      :revision="revision"
      :overview="overview"
      :history="history"
      :branches="branches"
      :files="files"
      :git-sync="gitSync"
      @command="editorCommands.run($event)"
      @refresh="refresh"
      @settings="openProjectSettings"
      @changed="treeChanged"
      @deleted="entryDeleted"
      @moved="entryMoved"
    />
    <div
      v-show="!sidebarHidden"
      class="resize-handle tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина дерева файлов"
      tabindex="0"
      @pointerdown="resizeTree"
      @keydown="resizeTreeKey"
    />
    <section
      class="dock-pane"
      aria-label="Блоки редактора и терминалов"
      @focusin="editorFocus"
      @keydown.capture="editorKeydown"
    >
      <p v-if="loading" class="loading" role="status">читаю файл…</p>
      <WorkbenchDock
        :project-id="projectId"
        :workbench="workbench"
        :files="files"
        :tab-actions="tabActions"
        :panel-hosts="panelHosts"
        :keep-alive="keepAlive"
        :gutter-revision="gutterRevision"
        :tabs="tabs"
        :virtual-keys="{ agent: virtualTabs.agent.key, project: virtualTabs.project.key }"
      >
        <template #project><slot name="project" /></template>
      </WorkbenchDock>
    </section>
    <TerminalCloseDialog
      :session="terminals.pendingClose.value"
      :busy="terminals.busy.value"
      @cancel="terminals.cancelClose"
      @confirm="terminals.confirmClose"
    />
  </div>
</template>

<style scoped>

.workspace {
  display: grid;
  grid-template-columns: var(--tree-width, clamp(200px, 19vw, 280px)) 1px minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
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
@media (max-width: 1050px) {
  .workspace {
    grid-template-columns: 190px minmax(250px, 1fr);
    grid-template-rows: auto auto auto auto;
    height: auto;
    min-height: 0;
  }
  .workspace.sidebar-hidden {
    grid-template-columns: 0 minmax(250px, 1fr);
  }
  .resize-handle {
    display: none;
  }
  .dock-pane {
    grid-column: 2;
    grid-row: 3;
    height: 65dvh;
    min-height: 400px;
  }
}
@media (max-width: 700px) {
  .dock-pane {
    height: auto;
    min-height: 0;
  }
}
@media (max-width: 600px) {
  .workspace,
  .workspace.sidebar-hidden {
    grid-template-columns: minmax(0, 1fr);
  }
  .dock-pane {
    grid-column: 1;
    grid-row: 4;
  }
}
</style>
