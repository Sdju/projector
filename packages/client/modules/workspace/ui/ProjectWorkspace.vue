<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiLoader from "../../../common/ui/UiLoader.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import WorkspaceFrame from "./WorkspaceFrame.vue";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import {
  workspaceProfile,
  profileCapabilities,
  extendSidebarRegistry,
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
import { registerAgentCommands } from "../../agent/index.ts";
import { onAgentTurnEnd } from "../../agent-core/index.ts";
import { registerEditorCommands } from "../lib/editor-commands.ts";
import { useTemporarySidebarSections } from "../lib/temporary-sidebar-sections.ts";
import { useWorkspaceSession } from "../lib/workspace-session.ts";
import WorkbenchDock from "./WorkbenchDock.vue";
import StatusBar from "./StatusBar.vue";
import DockWidgets from "./DockWidgets.vue";
import { useDockWorkspace } from "../lib/dock-commands.ts";
import type { DockTarget } from "../../dock/index.ts";
import { type OpenFile } from "../open-file.ts";
import { fileScopeKey, isLiveScope } from "@ai-projector/core/modules/workspace/index.ts";
import { createPanelHosts } from "../panel-hosts.ts";
import { TerminalCloseDialog } from "../../terminal/index.ts";
import { useDocker } from "../../docker/index.ts";
import { sidebarSections, type SidebarViews } from "../lib/sidebar-views.ts";
import { useWorkspaceSidebarLayout } from "../lib/sidebar-layout.ts";
import { useWorkspaceAsidePanel } from "../lib/workspace-aside.ts";
import { provideLastSession } from "../lib/session-launchers.ts";
import { registerTreeCommands } from "../lib/tree-commands.ts";
import { provideTabHost, useWorkspaceTabTypes, type TabViews } from "../lib/tab-views.ts";
import {
  registerPluginWorkspaceCommands,
  usePluginWorkspaceViews,
} from "../lib/plugin-workspace.ts";
import { useWorkspaceRefresh } from "../lib/workspace-refresh.ts";
import { useRightPanelPreference } from "../lib/right-panel.ts";
import { useMobileSurfaces, registerMobileCommands } from "../lib/mobile-surfaces.ts";
import { useSurfaceSwipe } from "../lib/surface-swipe.ts";
import { registerProjectWidgetCommands } from "../../project-widgets/index.ts";
import { useWorkspaceZen } from "../lib/zen.ts";
import { connectReviewWorkspace } from "../modules/review/index.ts";
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
  tabViews?: TabViews; // views of the kinds the embedding page owns
  sidebarViews?: SidebarViews;
  asideViews?: SidebarViews;
}>();
const profile = workspaceProfile(props.projectId),
  capabilities = profileCapabilities(profile);
const tabTypes = useWorkspaceTabTypes(profile, props.tabViews, {
  project: {
    dirty: () => !!props.projectSettingsDirty,
    beforeClose: () => props.beforeCloseProjectSettings?.(),
    save: () => props.saveProjectSettings?.(),
  },
});
const frame = ref<InstanceType<typeof WorkspaceFrame>>();
const workspaceElement = computed(() => frame.value?.element);
const sidebarHidden = ref(false);
const { mobile, mobileSurface, mobileSidebarOpen, sidebarInvisible, showSidebar } =
  useMobileSurfaces(sidebarHidden);
const { treeWidth, asideWidth, sizes, resizeTree, resizeTreeKey, resizeAside, resizeAsideKey } =
  useSidebarResize(workspaceElement);
const sidebar = ref<InstanceType<typeof WorkspaceSidebar>>(),
  asidePanel = ref<InstanceType<typeof WorkspaceSidebar>>();
const editorCommands = useCommandScope(`editor:${props.projectId}`, () => ({
  surface: "editor",
  projectId: props.projectId,
}));
const { zenMode, shortcut: zenShortcut } = useWorkspaceZen(editorCommands);
useSurfaceSwipe({
  workspace: workspaceElement,
  mobile,
  surface: mobileSurface,
  terminals: () => capabilities.terminals,
  show: (surface) => editorCommands.run("ide.workbench.mobile.surface.show", { surface }),
});
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
useDockWorkspace(registerEditor, () => tabTypes.has("inbox"));
registerAgentCommands(registerEditor, props.projectId);
registerProjectWidgetCommands(editorCommands.scope, () => props.projectId);
function treeChanged() {
  revision.value++;
  void loadGit();
}
function entryDeleted(path: string) {
  files.invalidate();
  tabs.value = tabs.value.filter(
    (tab) =>
      tab.virtual ||
      tab.commit ||
      (tab.scope && !isLiveScope(tab.scope)) ||
      (tab.path !== path && !tab.path.startsWith(path + "/")),
  );
  revision.value++;
  void loadGit();
  sidebar.value?.refreshSearch();
}
const overview = useGitOverview(() => props.projectId);
const history = useGitHistory(() => props.projectId);
const branches = useGitBranches(() => props.projectId);
const loadGit = () => (capabilities.git ? overview.load() : Promise.resolve());
/** An answer of the agent may leave edits and commits: the Git panel reads them again. */
const releaseAgentTurnEnd = onAgentTurnEnd(props.projectId, () => void loadGit());
const section = ref("files"),
  {
    extraSections,
    openTree,
    openCommitTree,
    openSearch,
    restoreSections,
    closeSection,
    openSection,
  } = useTemporarySidebarSections(
    capabilities,
    (id) => showSection(id),
    (id, removed) => {
      if (removed?.group && sections.value.has(removed.group)) {
        if (section.value === id) section.value = removed.group;
        if (asideSection.value === id) asideSection.value = removed.group;
      } else if (section.value === id && sidebarLayout.sideOf("git") === "left" && capabilities.git)
        section.value = "git";
    },
  );
const { override: rightPanelOverride, enabled: rightPanelEnabled } = useRightPanelPreference();
const { pluginSidebarSections, mergedSidebarViews } = usePluginWorkspaceViews(props.sidebarViews);
const lastSession = ref("shell");
provideLastSession(lastSession);
const sections = computed(() =>
  extendSidebarRegistry(sidebarSections(profile, capabilities), () => [
    ...extraSections.value,
    ...pluginSidebarSections.value,
  ]),
);
const revision = ref(0);
const isDirty = (file: OpenFile) =>
  file.virtual
    ? !!tabTypes.behaviorOf(file.virtual)?.dirty?.()
    : file.draft !== undefined && file.draft !== file.content;
const tabs = ref<OpenFile[]>([]);
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
  onRevealAside: () => {
    if (asideVisible.value && asideRegistry.has("terminals")) showSection("terminals");
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
  layoutGroups,
  currentPreset,
  presetsAvailable,
} = workbench;
const {
  hidden: asideHidden,
  middle: asideBottom,
  shown: asideShown,
  visible: asideVisible,
  show: showAside,
  asideTarget,
  section: asideSection,
  registry: asideRegistry,
  views: asideViews,
} = useWorkspaceAsidePanel({
  profile,
  capabilities,
  mobile,
  enabled: () => rightPanelEnabled.value,
  override: rightPanelOverride,
  layout,
  register: registerEditor,
  views: props.asideViews,
  addedSections: () => movedSections.value,
  refresh: (id = asideSection.value) =>
    asideRegistry.has(id)
      ? asidePanel.value?.refreshSection(id)
      : sidebar.value?.refreshSection(id),
});
const {
  layout: sidebarLayout,
  movedSections,
  rightSections,
  showSection,
} = useWorkspaceSidebarLayout({
  projectId: () => props.projectId,
  sections,
  asideRegistry,
  section,
  asideSection,
  showSidebar,
  showAside,
  rightAvailable: () => asideVisible.value,
  canTransfer: () => asideShown.value && !asideBottom.value && !zenMode.value,
  register: registerEditor,
});
const rightViews = computed(() => ({ ...mergedSidebarViews.value, ...asideViews.value }));
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
const { loading, openFile, openTab, saveFile, toggleMarkdownSource } = files;
provideTabHost({
  projectId: props.projectId,
  openFile: (path, line) => void openFile(path, line),
  openTab,
  openCommitDiff: (hash, path) => void files.openCommitFile(hash, path),
  openCommitTree,
  openCompareTree: (from, to) => openTree({ kind: "compare", from, to }),
  openPullFile: (number, path, head, pinned, base) => {
    // Opening a file must not replace the merge request preview tab that led to it.
    const pull = tabs.value.find(
      (tab) => tab.virtual === "pull" && Number(tab.params?.number) === number,
    );
    if (pull) pull.preview = false;
    void files.openPullFile(number, path, head, !pinned, base);
  },
  openSection,
  run: (command, args) => editorCommands.run(command, args),
  executeCommand: (command, args) => editorCommands.scope.executeCommand(command, args),
});
connectReviewWorkspace({
  projectId: props.projectId,
  register: registerEditor,
  run: (id, args) => editorCommands.scope.executeCommand(id, args),
  openTab: () => openTab("review"),
  openFile: (path, from, to, staged) =>
    openFile(path, from, undefined, staged, { endLine: to, preview: false }),
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
  reloadFromDisk: files.reloadFromDisk,
  keepMine: files.keepMine,
  openFile,
  openFileAt: (path, line, endLine, column, options) =>
    openFile(path, line, column, undefined, { endLine, ...options }),
  openTab,
  selectTab: (key) => revealPanel(key),
  onOpenTab: () => (mobileSidebarOpen.value = false),
  toggleMarkdownSource,
  revealInTree: async (path, scope) => {
    const id = scope && !isLiveScope(scope) ? `tree:${fileScopeKey(scope)}` : "files";
    if (!sections.value.has(id)) return;
    showSection(id);
    await nextTick();
    sidebar.value?.reveal(path, id);
  },
  tabTypes,
});
registerPluginWorkspaceCommands({
  tabTypes,
  registerEditor,
  openTab,
  showSection,
});
editorCommands.scope.activate();
const docker = useDocker(props.projectId, {
  enabled: capabilities.docker,
  sidebar: () => showSection("docker"),
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
registerTreeCommands({
  projectId: props.projectId,
  capabilities,
  openTree,
  register: registerEditor,
});
registerEditor(
  "ide.workbench.section.close",
  "Закрыть временный раздел боковой панели",
  (value) => {
    const id = commandArgs(value).section;
    if (typeof id !== "string" || !id) throw new Error("Укажите section");
    closeSection(id);
  },
  (value) => {
    const id = commandArgs(value).section;
    return typeof id === "string" && extraSections.value.some((type) => type.id === id);
  },
  undefined,
  {
    description: "Закрывает временный раздел боковой панели, например файлы коммита.",
    arguments: { section: "Идентификатор временного раздела" },
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
  sections: sections.value,
  sectionExists: (id) => sections.value.has(id),
  extraSections,
  restoreSections,
  treeWidth,
  asideWidth,
  sidebarHidden,
  rightPanel: rightPanelOverride,
  launcher: lastSession,
  mobile,
  mobileSurface,
  terminals: capabilities.terminals,
  ensureTab: (id, params) => ensureTab(tabs, tabTypes, id, params),
  openFile,
  fileGeneration: files.generation,
  resetFiles: files.reset,
  openCommitFile: files.openCommitFile,
  openPullFile: files.openPullFile,
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
  section: computed(() =>
    sidebarLayout.sideOf("search") === "right" ? asideSection.value : section.value,
  ),
  searchPanel: () => sidebar.value,
  loadGit,
});
defineExpose({ openFile, refresh, openTab, openSection });
onBeforeUnmount(() => {
  releaseAgentTurnEnd();
  overview.cancel();
});
</script>

<template>
  <WorkspaceFrame
    ref="frame"
    :sidebar-invisible="sidebarInvisible"
    :aside-shown="asideShown"
    :aside-hidden="asideHidden"
    :aside-bottom="asideBottom"
    :zen="zenMode"
    :mobile="mobile"
    :mobile-surface="mobileSurface"
    :mobile-sidebar-open="mobileSidebarOpen"
    :sizes="sizes"
    @tree-pointer="resizeTree"
    @tree-key="resizeTreeKey"
    @aside-pointer="resizeAside"
    @aside-key="resizeAsideKey"
    @close-sidebar="editorCommands.run('ide.workbench.sidebar.toggle')"
  >
    <template #toolbar>
      <Teleport to="#header-tools" defer>
        <WorkbenchToolbar
          :project-id="projectId"
          :capabilities="capabilities"
          :mobile="mobile"
          :sidebar-hidden="sidebarInvisible"
          :terminals-busy="terminals.busy.value"
          :terminals-error="terminals.error.value"
          :layout-groups="layoutGroups"
          :preset="currentPreset"
          :presets-available="presetsAvailable"
          :inbox="tabTypes.has('inbox')"
          @command="(id, args) => editorCommands.run(id, args)"
        >
          <template v-if="$slots['project-run']" #project-run><slot name="project-run" /></template>
          <template v-if="$slots['project-repository']" #project-repository
            ><slot name="project-repository"
          /></template>
          <template #terminal-status><slot name="terminal-status" /></template>
        </WorkbenchToolbar>
      </Teleport>
    </template>
    <template #sidebar>
      <WorkspaceSidebar
        ref="sidebar"
        v-model:section="section"
        :inert="zenMode"
        :project-id="projectId"
        :capabilities="capabilities"
        :sections="sections"
        :layout="sidebarLayout"
        :right-target="asidePanel?.panelTarget"
        :right-section="asideSection"
        :views="mergedSidebarViews"
        :hidden="sidebarInvisible"
        :rail="!mobile"
        :active="active"
        :revision="revision"
        :overview="overview"
        :history="history"
        :branches="branches"
        :files="files"
        :git-sync="gitSync"
        :execute-command="(id, args) => editorCommands.scope.executeCommand(id, args)"
        @command="
          (id, args) =>
            (id.startsWith('ide.docker.') ? docker.commands : editorCommands).run(id, args)
        "
        @navigate="mobileSidebarOpen = false"
        @open-commit-tree="openCommitTree"
        @open-search="openSearch"
        @refresh="refresh"
        @changed="treeChanged"
        @deleted="entryDeleted"
        @moved="entryMoved"
      />
    </template>
    <template #aside>
      <WorkspaceSidebar
        ref="asidePanel"
        class="aside"
        :inert="zenMode"
        v-model:section="asideSection"
        side="right"
        :project-id="projectId"
        :capabilities="capabilities"
        :sections="rightSections"
        :layout="sidebarLayout"
        :owned-sections="asideRegistry"
        :views="rightViews"
        :external-refreshing="
          !asideRegistry.has(asideSection) && sidebar?.sectionRefreshing(asideSection)
        "
        :hidden="asideHidden"
        :rail="!asideBottom"
        :active="active"
        :revision="revision"
        :overview="overview"
        :history="history"
        :branches="branches"
        :files="files"
        :git-sync="gitSync"
        :execute-command="(id, args) => editorCommands.scope.executeCommand(id, args)"
        toggle-command="ide.workbench.aside.toggle"
        refresh-command="ide.workbench.aside.refresh"
        :close-command="
          asideRegistry.has(asideSection)
            ? 'ide.workbench.aside.section.close'
            : 'ide.workbench.section.close'
        "
        @command="
          (id, args) =>
            (id.startsWith('ide.docker.') ? docker.commands : editorCommands).run(id, args)
        "
        @open-commit-tree="openCommitTree"
        @open-search="openSearch"
        @refresh="refresh"
        @changed="treeChanged"
        @deleted="entryDeleted"
        @moved="entryMoved"
      />
    </template>
    <template #dock>
      <section
        class="dock-pane"
        :inert="mobile && mobileSidebarOpen && !zenMode"
        aria-label="Блоки редактора и терминалов"
        @focusin="editorFocus"
        @keydown.capture="editorKeydown"
      >
        <UiLoader v-if="loading" class="loading">читаю файл…</UiLoader>
        <WorkbenchDock
          :project-id="projectId"
          :workbench="workbench"
          :mobile="mobile"
          :mobile-surface="mobileSurface"
          :zen="zenMode"
          :aside="asideShown && !zenMode"
          :aside-target="asideTarget"
          :files="files"
          :tab-actions="tabActions"
          :panel-hosts="panelHosts"
          :gutter-revision="overview.gutterRevision.value"
          :tabs="tabs"
          :terminals-busy="terminals.busy.value"
          :agent="capabilities.agent"
          @command="(id, args) => editorCommands.run(id, args)"
        />
      </section>
    </template>
    <MobileSurfaces
      v-if="mobile"
      v-show="!zenMode"
      :inert="zenMode"
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
    <StatusBar
      v-if="!mobile"
      v-show="!zenMode"
      :inert="zenMode"
      :inbox="tabTypes.has('inbox')"
      class="workspace-status"
      @command="(id, args) => editorCommands.run(id, args)"
    />
    <DockWidgets
      :inbox="tabTypes.has('inbox')"
      :mobile="mobile"
      @command="(id, args) => editorCommands.run(id, args)"
    />
    <UiButton
      v-if="zenMode"
      shape="icon"
      size="sm"
      class="zen-exit"
      :title="`Выйти из режима Zen (${zenShortcut ? `${zenShortcut} · ` : ''}Esc)`"
      aria-label="Выйти из режима Zen"
      data-command="ide.workbench.zen.toggle"
      @click="editorCommands.run('ide.workbench.zen.toggle', { on: false })"
    >
      <ProjectorIcon name="minimize-2" aria-hidden="true" />
    </UiButton>
  </WorkspaceFrame>
</template>

<style scoped>
.loading {
  position: absolute;
  top: 4px;
  right: 14px;
  z-index: var(--z-sticky);
  background: var(--bg-2);
  padding: 6px var(--sp-3);
  color: var(--muted);
}
</style>
