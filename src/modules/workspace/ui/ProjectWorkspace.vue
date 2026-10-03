<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import {
  workspaceProfile,
  profileCapabilities,
  refreshWorkspace,
  type WorkspaceCapability,
} from "../../workspace-api/index.ts";
import { relocatedPath } from "../../../../core/modules/workspace/index.ts";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
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
import { replacePanel, type DockTarget } from "../../dock/index.ts";
import { type OpenFile } from "../open-file.ts";
import { createPanelHosts } from "../panel-hosts.ts";
import { TerminalCloseDialog } from "../../terminal/index.ts";
import { useDocker } from "../../docker/index.ts";
import { virtualTabs } from "../lib/virtual-tabs.ts";
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
// Mobile navigation is transient; keep the saved desktop layout independent.
const mobile = useMediaQuery("(max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse)");
const mobileSurface = ref<"editor" | "files" | "terminal">("editor");
const mobileActionsOpen = ref(false);
const mobileSidebarOpen = computed({
  get: () => mobileSurface.value === "files",
  set: (open: boolean) => { mobileSurface.value = open ? "files" : "editor"; },
});
const sidebarInvisible = computed(() => mobile.value ? !mobileSidebarOpen.value : sidebarHidden.value);
function showSidebar() {
  if (mobile.value) mobileSidebarOpen.value = true;
  else sidebarHidden.value = false;
}
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
editorCommands.scope.registerCommand({
  id: "ide.workbench.mobile.surface.show",
  title: "Открыть мобильную поверхность",
  description: "Переключает мобильный интерфейс между редактором, файлами слева и терминалами справа, сохраняя сессии.",
  arguments: { surface: "editor, files или terminal" },
  enabled: () => mobile.value,
  run: (value) => {
    const { surface } = commandArgs(value);
    if (
      (surface === "terminal" && !capabilities.terminals) ||
      (surface !== "editor" && surface !== "files" && surface !== "terminal")
    )
      throw new Error("surface: editor, files или terminal");
    mobileSurface.value = surface;
    mobileActionsOpen.value = false;
  },
});
editorCommands.scope.registerCommand({
  id: "ide.workbench.mobile.actions.toggle", title: "Показать действия проекта",
  description: "Раскрывает команды запуска проекта и создания терминалов в мобильном интерфейсе.",
  enabled: () => mobile.value,
  run: () => { mobileActionsOpen.value = !mobileActionsOpen.value; },
});
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
watch(activeKey, (key) => { if (key) mobileSurface.value = "editor"; });
watch(() => workbench.focusedGroup.value?.active, (id) => {
  if (mobile.value && !restoringSession.value && id?.startsWith("terminal:"))
    mobileSurface.value = "terminal";
});
watch(mobile, () => { mobileSurface.value = "editor"; mobileActionsOpen.value = false; });
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
  await refreshWorkspace(props.projectId);
  revision.value++;
  await loadGit();
  if (section.value === "search") await sidebar.value?.search();
  if (!capabilities.write) {
    const selected = activeKey.value;
    for (const tab of [...tabs.value])
      if (!tab.virtual && !tab.commit && !tab.localFile)
        await openFile(tab.path, tab.line, tab.column, undefined, {
          reload: true,
          preview: !!tab.preview,
        });
    if (tabs.value.some((tab) => tab.key === selected)) selectTab(selected);
    return;
  }
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
  </div>
</template>

<style scoped src="./ProjectWorkspace.css" />
