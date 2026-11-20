<script setup lang="ts">
import UiLoader from "../../../common/ui/UiLoader.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiResizeHandle from "../../../common/ui/UiResizeHandle.vue";
import IconMinimize from "~icons/lucide/minimize-2";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import {
  workspaceProfile,
  profileCapabilities,
  extendSidebarRegistry,
  type SidebarType,
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
import { useWorkspaceSession } from "../lib/workspace-session.ts";
import WorkbenchDock from "./WorkbenchDock.vue";
import StatusBar from "./StatusBar.vue";
import type { DockTarget } from "../../dock/index.ts";
import { type OpenFile } from "../open-file.ts";
import {
  fileScopeKey,
  fileScopeNote,
  fileScopeTitle,
  isLiveScope,
  type FileScope,
} from "@ai-projector/core/modules/workspace/index.ts";
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
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
  tabViews?: TabViews; // views of the kinds the embedding page owns
  sidebarViews?: SidebarViews;
  asideViews?: SidebarViews;
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
// The agent chats are tabs that come and go; their commands live as long as this workspace.
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
  extraSections = ref<SidebarType[]>([]);
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
function openTree(scope: FileScope) {
  if (!capabilities.snapshots) throw new Error("Источник не умеет показывать файлы снимка");
  const id = `tree:${fileScopeKey(scope)}`;
  if (!extraSections.value.some((type) => type.id === id))
    extraSections.value.push({
      id,
      title: fileScopeTitle(scope),
      source: fileScopeNote(scope),
      group: capabilities.git ? "git" : undefined,
      kind: scope.kind === "compare" ? "changes" : "tree",
      params: { scope },
      closable: true,
    });
  showSection(id);
}
function openCommitTree(hash: string) {
  openTree({ kind: "commit", rev: hash });
}
function openSearch(scope: FileScope) {
  if (scope.kind !== "commit") throw new Error("Поиск доступен только для коммита");
  if (!capabilities.search) throw new Error("Источник не умеет искать по снимку");
  const id = `search:${fileScopeKey(scope)}`;
  if (!extraSections.value.some((type) => type.id === id))
    extraSections.value.push({
      id,
      title: "Поиск по снимку",
      source: fileScopeNote(scope),
      group: capabilities.git ? "git" : undefined,
      kind: "search-scope",
      params: { scope },
      closable: true,
    });
  showSection(id);
}
/** Rebuilds temporary sections from a session; view kinds and scopes are derived, not trusted. */
function restoreSections(saved: SidebarType[]) {
  extraSections.value = saved.flatMap((type) => {
    const raw = type.params?.scope;
    if (!raw || typeof raw !== "object") return [];
    const value = raw as { kind?: unknown; rev?: unknown; from?: unknown; to?: unknown };
    const scope: FileScope | undefined =
      value.kind === "commit" && typeof value.rev === "string"
        ? { kind: "commit", rev: value.rev }
        : value.kind === "compare" && typeof value.from === "string" && typeof value.to === "string"
          ? { kind: "compare", from: value.from, to: value.to }
          : undefined;
    if (!scope) return [];
    if (scope.kind === "compare" ? !capabilities.compare : !capabilities.snapshots) return [];
    const search = type.kind === "search-scope";
    if (search && (scope.kind !== "commit" || !capabilities.search)) return [];
    return [
      {
        id: search ? `search:${fileScopeKey(scope)}` : `tree:${fileScopeKey(scope)}`,
        title: search ? "Поиск по снимку" : fileScopeTitle(scope),
        source: fileScopeNote(scope),
        group: capabilities.git ? "git" : undefined,
        kind: search ? "search-scope" : scope.kind === "compare" ? "changes" : "tree",
        params: { scope },
        closable: true,
      } satisfies SidebarType,
    ];
  });
}
function closeSection(id: string) {
  const index = extraSections.value.findIndex((type) => type.id === id);
  if (index < 0) return;
  const [removed] = extraSections.value.splice(index, 1);
  if (removed?.group && sections.value.has(removed.group)) {
    if (section.value === id) section.value = removed.group;
    if (asideSection.value === id) asideSection.value = removed.group;
  } else if (section.value === id && sidebarLayout.sideOf("git") === "left" && capabilities.git)
    section.value = "git";
}
/** Adds or updates a temporary sidebar section and reveals it; tab views own its contents. */
function openSection(type: SidebarType) {
  const index = extraSections.value.findIndex((item) => item.id === type.id);
  if (index >= 0) extraSections.value.splice(index, 1, type);
  else extraSections.value.push(type);
  showSection(type.id);
}
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
  <div
    ref="workspaceElement"
    class="workspace"
    :class="{
      'sidebar-hidden': sidebarInvisible,
      'has-aside': asideShown,
      'aside-hidden': asideHidden,
      'aside-bottom': asideShown && asideBottom,
      zen: zenMode,
    }"
    :data-surface="mobile ? mobileSurface : undefined"
    :style="sizes"
  >
    <div class="toolbar-host">
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
    </div>
    <Transition name="mobile-left">
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
    </Transition>
    <UiResizeHandle
      appearance="gap"
      orientation="vertical"
      v-show="!sidebarInvisible"
      class="resize-handle tree-resize"
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
    <WorkspaceSidebar
      v-if="asideShown"
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
    <UiResizeHandle
      v-if="asideShown && !asideHidden && !asideBottom"
      appearance="gap"
      orientation="vertical"
      class="resize-handle aside-resize"
      aria-label="Ширина правой панели"
      tabindex="0"
      @pointerdown="resizeAside"
      @keydown="resizeAsideKey"
    />
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
    <StatusBar v-if="!mobile" v-show="!zenMode" :inert="zenMode" class="workspace-status" />
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
      <IconMinimize aria-hidden="true" />
    </UiButton>
  </div>
</template>

<style scoped>
.workspace {
  --rail-w: 40px;
  --aside-width: clamp(240px, 21vw, 320px);
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
/* Правая полоса разделов: её колонка остаётся, даже когда панель свёрнута. */
.workspace.has-aside {
  grid-template-columns:
    var(--tree-width, clamp(240px, 21vw, 320px)) var(--island-gap) minmax(0, 1fr)
    var(--island-gap) var(--aside-width);
}
.workspace.sidebar-hidden.has-aside {
  grid-template-columns:
    calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
    var(--aside-width);
}
.workspace.has-aside.aside-hidden {
  grid-template-columns:
    var(--tree-width, clamp(240px, 21vw, 320px)) var(--island-gap) minmax(0, 1fr)
    var(--island-gap) calc(var(--rail-w) - var(--island-gap));
}
.workspace.sidebar-hidden.has-aside.aside-hidden {
  grid-template-columns:
    calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
    calc(var(--rail-w) - var(--island-gap));
}
.workspace > .aside {
  grid-column: 5;
  grid-row: 3;
}
.tree-resize {
  grid-column: 2;
  grid-row: 3;
}
.aside-resize {
  grid-column: 4;
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
.loading {
  position: absolute;
  top: 4px;
  right: 14px;
  z-index: var(--z-sticky);
  background: var(--bg-2);
  padding: 6px var(--sp-3);
  color: var(--muted);
}
@media (max-width: 1050px) and (min-width: 701px) {
  .dock-pane {
    overflow: auto;
  }
  .workspace {
    --aside-width: clamp(200px, 24vw, 260px);
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr);
  }
  .workspace.sidebar-hidden {
    grid-template-columns: calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr);
  }
  .workspace.has-aside {
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr) var(--island-gap) var(
        --aside-width
      );
  }
  .workspace.has-aside.aside-bottom {
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) minmax(180px, 34vh) auto;
  }
  .workspace.has-aside.aside-bottom > .aside {
    grid-column: 3;
    grid-row: 4;
  }
  .workspace.has-aside.aside-bottom > .sidebar:not(.aside),
  .workspace.has-aside.aside-bottom > .tree-resize {
    grid-row: 3 / 5;
  }
  .workspace.has-aside.aside-bottom > .workspace-status {
    grid-row: 5;
  }
  .workspace.sidebar-hidden.has-aside {
    grid-template-columns:
      calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
      var(--aside-width);
  }
  .workspace.has-aside.aside-hidden {
    grid-template-columns:
      260px var(--island-gap) minmax(0, 1fr) var(--island-gap)
      calc(var(--rail-w) - var(--island-gap));
  }
  .workspace.sidebar-hidden.has-aside.aside-hidden {
    grid-template-columns:
      calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
      calc(var(--rail-w) - var(--island-gap));
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
  .aside-resize {
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
.workspace.zen,
.workspace.zen.sidebar-hidden,
.workspace.zen.has-aside,
.workspace.zen.sidebar-hidden.has-aside,
.workspace.zen.has-aside.aside-hidden,
.workspace.zen.sidebar-hidden.has-aside.aside-hidden {
  position: relative;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  column-gap: 0;
}
.workspace.zen > .sidebar,
.workspace.zen > .aside,
.workspace.zen > .aside-resize,
.workspace.zen > .tree-resize,
.workspace.zen > .sidebar-backdrop,
.workspace.zen > .workspace-status,
.workspace.zen > .mobile-surfaces {
  display: none;
}
.workspace.zen .dock-pane {
  grid-column: 1;
  grid-row: 1;
  overflow: hidden;
  border: 0;
  border-radius: 0;
}
.zen-exit {
  position: absolute;
  top: max(var(--sp-2), env(safe-area-inset-top));
  right: max(var(--sp-2), env(safe-area-inset-right));
  z-index: var(--z-expanded);
  border: 1px solid var(--line);
  background: var(--bg-2);
  box-shadow: var(--shadow-popover);
  opacity: 0.45;
  transition:
    opacity var(--t-fast),
    background var(--t-fast),
    color var(--t-fast);
}
.zen-exit:hover,
.zen-exit:focus-visible {
  opacity: 1;
  background: var(--bg-3);
  color: var(--text);
}
</style>
