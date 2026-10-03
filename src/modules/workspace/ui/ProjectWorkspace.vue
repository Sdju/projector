<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useSessionSnapshot, workspaceSessionSchema, type WorkspaceSession } from "../session.ts";
import { workspaceRequest } from "../api.ts";
import { relocatedPath } from "../../../../core/modules/workspace/index.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import IconDiff from "~icons/lucide/file-diff";
import FileTree from "./FileTree.vue";
import SearchPanel from "./SearchPanel.vue";
import WorkbenchToolbar from "./WorkbenchToolbar.vue";
import SidebarTabs, { type SidebarSection } from "./SidebarTabs.vue";
import GitPanel from "./GitPanel.vue";
import { useGitOverview } from "../lib/git-overview.ts";
import { useSidebarResize } from "../lib/sidebar-resize.ts";
import { useOpenFiles } from "../lib/open-files.ts";
import { useWorkbenchLayout } from "../lib/workbench-layout.ts";
import FilePanel from "./FilePanel.vue";
import PanelHost from "./PanelHost.vue";
import { AgentChat } from "../../agent/index.ts";
import { DockView, createDockLayout, parseDockLayout, replacePanel, serializeDockLayout, type DockTarget } from "../../dock/index.ts";
import { isEditable, isMarkdown, type OpenFile } from "../open-file.ts";
import { createPanelHosts } from "../panel-hosts.ts";
import IconRestart from "~icons/lucide/rotate-ccw";
import IconFailed from "~icons/lucide/circle-slash";
import IconFinishFlag from "../../../common/ui/IconFinishFlag.vue";
import { TerminalCloseDialog, TerminalView } from "../../terminal/index.ts";
import type { FileContent } from "../../../../core/modules/workspace/index.ts";
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
}>();
const workspaceElement = ref<HTMLElement>();
const sidebarHidden = ref(false);
const { treeWidth, sizes, resizeTree, resizeTreeKey } = useSidebarResize(workspaceElement);
const fileTree = ref<InstanceType<typeof FileTree>>();
const editorCommands = useCommandScope(`editor:${props.projectId}`, () => ({
  surface: "editor",
  projectId: props.projectId,
}));
function commandFile(value?: unknown) {
  const args = commandArgs(value);
  if (args.id !== undefined && typeof args.id !== "string")
    throw new Error("id должен быть строкой");
  return tabs.value.find((tab) => !tab.virtual && tab.key === (args.id ?? activeKey.value));
}
const registerEditor = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
) => editorCommands.scope.registerCommand({ id, title, run, enabled });
registerEditor(
  "ide.editor.file.save",
  "Сохранить",
  async (args) => {
    const file = commandFile(args)!;
    if (!(await saveFile(file))) throw new Error(file.saveError || "Не удалось сохранить файл");
  },
  (args) => !!commandFile(args) && isEditable(commandFile(args)!),
);
registerEditor(
  "ide.editor.file.reveal",
  "Показать в дереве файлов",
  (args) => {
    section.value = "files";
    sidebarHidden.value = false;
    fileTree.value?.reveal(commandFile(args)!.path);
  },
  (args) => !!commandFile(args) && !commandFile(args)!.external,
);
registerEditor(
  "ide.editor.file.copyRelativePath",
  "Копировать относительный путь",
  (args) => navigator.clipboard.writeText(commandFile(args)!.path),
  (args) => !!commandFile(args),
);
registerEditor(
  "ide.editor.markdown.toggleSource",
  "Переключить исходник Markdown",
  () => toggleMarkdownSource(),
  () => !!active.value && isMarkdown(active.value),
);
registerEditor(
  "ide.editor.file.open",
  "Открыть файл",
  (args) => openFile(commandFile(args)!.path),
  (args) => !!commandFile(args) && commandFile(args)!.original !== undefined,
);
function tabActions(id: string): ContextMenuItem[] {
  const file = fileOf(id);
  const common = [
    editorCommands.item("ide.workbench.panel.splitRight", { id }, { separator: true }),
    editorCommands.item("ide.workbench.panel.splitDown", { id }),
    editorCommands.item("ide.workbench.panel.hideGroup", { id }),
  ];
  if (!file || file.virtual) return common;
  return [
    ...(file.original !== undefined ? [editorCommands.item("ide.editor.file.open", { id })] : []),
    editorCommands.item("ide.editor.file.save", { id }, { separator: true }),
    editorCommands.item("ide.editor.file.reveal", { id }),
    editorCommands.item("ide.editor.file.copyRelativePath", { id }),
    ...common,
  ];
}
registerEditor(
  "ide.workbench.keybindings.open",
  "Открыть горячие клавиши",
  () => {
    const key = "settings:keybindings";
    if (!tabs.value.some((tab) => tab.key === key))
      tabs.value.push({ key, virtual: "keybindings", path: "Горячие клавиши", content: "" });
    selectTab(key);
  },
  () => true,
);
registerEditor(
  "ide.workbench.agent.open",
  "Открыть чат с агентом",
  () => {
    const key = "agent:chat";
    if (!tabs.value.some((tab) => tab.key === key))
      tabs.value.push({ key, virtual: "agent", path: "Агент", content: "" });
    selectTab(key);
  },
  () => true,
);
function editorKeydown(event: KeyboardEvent) {
  if (active.value?.virtual === "project" && (event.ctrlKey || event.metaKey)
    && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopPropagation();
    void props.saveProjectSettings?.();
    return;
  }
  if (
    !(event.target as Element).closest(
      ".keybindings-editor, .project-settings-form, .terminal-view",
    )
  )
    editorCommands.keydown(event);
}
function editorFocus(event: FocusEvent) {
  if (!(event.target as Element)?.closest(".workspace-tabs, .keybindings-editor, .terminal-view"))
    editorCommands.scope.activate();
}
function entryDeleted(path: string) {
  files.invalidate();
  tabs.value = tabs.value.filter(
    (tab) => tab.virtual || (tab.path !== path && !tab.path.startsWith(path + "/")),
  );
  revision.value++;
  void loadGit();
  searchPanel.value?.refresh();
}
const overview = useGitOverview(() => props.projectId);
const { git, gutterRevision, load: loadGit } = overview;
const gitPanel = ref<InstanceType<typeof GitPanel>>();
const section = ref<SidebarSection>("files");
const searchPanel = ref<InstanceType<typeof SearchPanel>>();
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
  terminalPanels,
  fileOf,
  activeKey,
  revealPanel,
  describePanel,
  selectPanel,
  closePanel,
  closeManyPanels,
  renamePanel,
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
  acceptsFileDrop,
  dropFiles,
  closeTab,
  selectTab,
  saveFile,
  prepareEntryChange,
  toggleMarkdownSource,
} = files;
const virtualTabs = {
  keybindings: {
    key: "settings:keybindings",
    path: "Горячие клавиши",
    title: "Настройки горячих клавиш",
  },
  agent: { key: "agent:chat", path: "Агент", title: "Чат с агентом Projector" },
  project: { key: "settings:project", path: "Настройки проекта", title: "Настройки проекта" },
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
const session = useSessionSnapshot(
  () => `projector:workspace:v1:${props.projectId}`,
  (): WorkspaceSession => ({
    tabs: tabs.value
      .filter((tab) => !tab.localFile)
      .map((tab) => ({
        key: tab.key,
        path: tab.path,
        virtual: tab.virtual,
        external: tab.external,
        staged: tab.staged,
        markdownMode: tab.markdownMode,
      })),
    activeKey: activeKey.value,
    section: section.value,
    treeWidth: treeWidth.value,
    sidebarHidden: sidebarHidden.value,
    layout: serializeDockLayout(layout.value),
  }),
  workspaceSessionSchema,
  () => !restoringSession.value,
);
let sessionGeneration = 0;
async function restoreSession(saved: WorkspaceSession | undefined, generation: number) {
  try {
    for (const tab of saved?.tabs ?? []) {
      if (generation !== sessionGeneration) return;
      if (tab.virtual) {
        const { key, path } = virtualTabs[tab.virtual];
        if (!tabs.value.some((file) => file.key === key))
          tabs.value.push({
            key,
            virtual: tab.virtual,
            path,
            content: "",
          });
        continue;
      }
      const completed = await openFile(
        tab.path,
        undefined,
        undefined,
        tab.staged,
        false,
        tab.external,
      );
      // A project switch or a user opening another file takes precedence over restoration.
      if (
        generation !== sessionGeneration ||
        completed === undefined ||
        completed !== files.generation()
      )
        return;
      const file = tabs.value.find((file) => file.key === tab.key);
      if (file) file.markdownMode = tab.markdownMode;
    }
    // Sessions saved before layouts existed only know the active tab.
    if (
      generation === sessionGeneration &&
      !parseDockLayout(saved?.layout) &&
      tabs.value.some((tab) => tab.key === saved?.activeKey)
    )
      activeKey.value = saved!.activeKey;
    if (generation === sessionGeneration && saved?.section === "project") openProjectSettings();
  } finally {
    if (generation === sessionGeneration) restoringSession.value = false;
  }
}

const active = computed(() => tabs.value.find((file) => file.key === activeKey.value));
async function prepareGitChange(action: string, paths: string[]) {
  if (action !== "discard") {
    for (const entry of paths)
      if (!(await prepareEntryChange(entry))) throw new Error("Не удалось сохранить файл");
    return;
  }
  if (!(await files.settle(paths[0]!))) throw new Error("Не удалось завершить сохранение файла");
}
async function gitChangeApplied(action: string, paths: string[]) {
  const path = paths[0]!;
  revision.value++;
  // Drop obsolete comparisons; reload a visible file after discard.
  const current = active.value;
  tabs.value = tabs.value.filter(
    (tab) => !paths.includes(tab.path) || (tab.original === undefined && action !== "discard"),
  );
  if (current?.path === path && action === "discard") {
    const exists = await workspaceRequest<FileContent>(props.projectId, "file", { path }).then(
      () => true,
      () => false,
    );
    if (exists) await openFile(path);
  }
  searchPanel.value?.refresh();
}
watch(
  () => props.projectId,
  () => {
    const saved = session.read();
    const generation = ++sessionGeneration;
    restoringSession.value = true;
    files.reset();
    overview.reset();
    layout.value = parseDockLayout(saved?.layout) ?? createDockLayout();
    section.value = saved?.section === "project" ? "files" : (saved?.section ?? "files");
    treeWidth.value = saved?.treeWidth;
    sidebarHidden.value = !!saved?.sidebarHidden;
    void loadGit();
    void restoreSession(saved, generation);
  },
  { immediate: true },
);
watch(section, (value) => {
  if (value === "git") void loadGit();
});
async function refresh() {
  revision.value++;
  await loadGit();
  if (section.value === "search") await searchPanel.value?.search();
  if (active.value?.virtual) return;
  if (active.value?.localFile) void openBrowserFile(active.value.localFile, true);
  else if (active.value)
    void openFile(
      active.value.path,
      active.value.line,
      active.value.column,
      active.value.staged,
      true,
      !!active.value.external,
    );
}
function entryMoved(source: string, destination: string) {
  files.invalidate();
  for (const tab of [...tabs.value]) {
    if (tab.virtual) continue;
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
  searchPanel.value?.refresh();
}
onBeforeUnmount(() => {
  ++sessionGeneration;
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
    <aside v-show="!sidebarHidden" class="sidebar" aria-label="Обзор проекта">
      <SidebarTabs
        v-model:section="section"
        :git-count="git.changes.length"
        :settings-active="active?.virtual === 'project'"
        @command="editorCommands.run($event)"
        @refresh="section === 'git' ? gitPanel?.refresh() : refresh()"
        @settings="openProjectSettings"
      />
      <div v-show="section === 'files'" class="side-content">
        <FileTree
          ref="fileTree"
          :before-change="prepareEntryChange"
          @changed="
            revision++;
            loadGit();
          "
          @deleted="entryDeleted"
          :project-id="projectId"
          :selected="active?.path ?? ''"
          :revision="revision"
          :git-changes="git.changes"
          @open="openFile($event)"
          @moved="entryMoved"
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
        :selected="active ? { path: active.path, staged: active.staged } : undefined"
        :prepare="prepareGitChange"
        :invalidate="files.invalidate"
        :applied="gitChangeApplied"
        @open="(path, staged) => openFile(path, undefined, undefined, staged)"
      />
    </aside>
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
      <DockView
        v-model:layout="layout"
        :describe="describePanel"
        :project-id="projectId"
        command-namespace="ide.workbench.tabs"
        :tab-actions="tabActions"
        :accepts-drop="acceptsFileDrop"
        @select="selectPanel"
        @close="closePanel"
        @close-many="closeManyPanels"
        @rename="renamePanel"
        @drop="dropFiles"
      >
        <template #panel="{ id, focused }">
          <PanelHost v-if="keepAlive.has(id)" :id="id" :registry="panelHosts" />
          <FilePanel
            v-else-if="fileOf(id)"
            :file="fileOf(id)!"
            :project-id="projectId"
            :revision="gutterRevision"
            @change="fileOf(id)!.draft = $event"
            @save="saveFile(fileOf(id))"
            @mode="fileOf(id)!.markdownMode = $event"
            @open="openFile($event)"
          />
          <TerminalView
            v-else-if="terminalPanels.get(id)"
            :project-id="projectId"
            :session="terminalPanels.get(id)!"
            :focused="focused"
            @open="
              (path, line, column, external) =>
                openFile(path, line, column, undefined, false, external)
            "
            @status="terminals.update"
            @sessions="terminals.replace"
            @ended="terminals.refresh"
          />
        </template>
        <template #icon="{ tab }">
          <IconDiff
            v-if="fileOf(tab.id)?.original !== undefined && fileOf(tab.id)"
            class="diff-tab-icon"
            aria-label="Изменения"
          />
          <template v-else-if="terminalPanels.get(tab.id)">
            <IconFailed
              v-if="terminals.failed(terminalPanels.get(tab.id)!)"
              class="session-state failed"
              aria-hidden="true"
            />
            <IconFinishFlag
              v-else-if="terminalPanels.get(tab.id)!.status === 'exited'"
              class="session-state"
              aria-hidden="true"
            />
          </template>
        </template>
        <template #actions="{ activeId }">
          <template v-if="terminalPanels.get(activeId)">
            <UiButton
              v-if="terminalPanels.get(activeId)!.status === 'running'"
              icon
              size="sm"
              :disabled="terminals.busy.value || terminalPanels.get(activeId)!.stopRequested"
              title="Завершить сессию"
              aria-label="Завершить сессию"
              @click="terminals.stop(terminalPanels.get(activeId)!.id)"
            >
              <IconFinishFlag aria-hidden="true" />
            </UiButton>
            <UiButton
              v-else
              icon
              size="sm"
              :disabled="terminals.busy.value"
              title="Перезапустить сессию"
              aria-label="Перезапустить сессию"
              @click="terminals.restart(terminalPanels.get(activeId)!.id)"
            >
              <IconRestart aria-hidden="true" />
            </UiButton>
          </template>
        </template>
        <template #empty="{ group }">
          <UiEmpty v-if="group.role === 'editor'">
            Откройте файл из дерева или перетащите его сюда
          </UiEmpty>
          <UiEmpty v-else-if="group.role === 'terminal'">
            Нет терминалов. Создайте сессию кнопками на панели выше
          </UiEmpty>
          <UiEmpty v-else>Перетащите сюда вкладку</UiEmpty>
        </template>
      </DockView>
    </section>
    <TerminalCloseDialog
      :session="terminals.pendingClose.value"
      :busy="terminals.busy.value"
      @cancel="terminals.cancelClose"
      @confirm="terminals.confirmClose"
    />
    <div class="keep-alive" hidden>
      <Teleport
        v-if="tabs.some((tab) => tab.virtual === 'agent')"
        :to="panelHosts.hosts[virtualTabs.agent.key] ?? null"
        :disabled="!panelHosts.hosts[virtualTabs.agent.key]"
      >
        <AgentChat :key="projectId" :project-id="projectId" />
      </Teleport>
      <Teleport
        v-if="tabs.some((tab) => tab.virtual === 'project')"
        :to="panelHosts.hosts[virtualTabs.project.key] ?? null"
        :disabled="!panelHosts.hosts[virtualTabs.project.key]"
      >
        <div class="project-settings"><slot name="project" /></div>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.diff-tab-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--run);
}
.session-state {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--muted);
}
.session-state.failed {
  color: var(--err);
}

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
.sidebar,
.dock-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sidebar {
  grid-column: 1;
  grid-row: 3;
}
.tree-resize {
  grid-column: 2;
  grid-row: 3;
}
.dock-pane {
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
.sidebar {
  background: var(--bg-sunken);
}
.project-settings {
  container-type: inline-size;
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.side-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.notice {
  padding: 0 var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
h3 {
  padding: 10px 12px 4px;
  margin: 0;
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
h3 span {
  margin-left: 6px;
  color: var(--faint);
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
  .sidebar {
    grid-row: 3;
    border-right: 1px solid var(--line);
    height: 65dvh;
    min-height: 400px;
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
  .sidebar,
  .dock-pane {
    grid-column: 1;
  }
  .sidebar {
    grid-row: 3;
    height: 260px;
    min-height: 0;
  }
  .dock-pane {
    grid-row: 4;
  }
}
</style>
