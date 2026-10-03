<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSessionSnapshot, workspaceSessionSchema, type WorkspaceSession } from "../session.ts";
import { workspaceRequest, saveWorkspaceFile } from "../api.ts";
import { isFileDrag, pathsFromDataTransfer } from "../../path-drop/index.ts";
import { projectRelativePath, previewBrowserFile } from "../file-drop.ts";
import { treeDragType } from "../tree-drag.ts";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
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
import FilePanel from "./FilePanel.vue";
import PanelHost from "./PanelHost.vue";
import { AgentChat } from "../../agent/index.ts";
import {
  DockView,
  activatePanel,
  addPanel,
  createDockLayout,
  dockGroups,
  findDockGroup,
  groupOfPanel,
  movePanel,
  parseDockLayout,
  reconcileDock,
  replacePanel,
  serializeDockLayout,
  setGroupHidden,
  type DockGroup,
  type DockLayout,
  type DockTabInfo,
  type DockTarget,
} from "../../dock/index.ts";
import { isEditable, isMarkdown, type OpenFile } from "../open-file.ts";
import { createPanelHosts } from "../panel-hosts.ts";
import IconRestart from "~icons/lucide/rotate-ccw";
import IconFailed from "~icons/lucide/circle-slash";
import IconFinishFlag from "../../../common/ui/IconFinishFlag.vue";
import {
  TerminalCloseDialog,
  TerminalView,
  useTerminalSessions,
} from "../../terminal/index.ts";
import type {
  FileComparison,
  FileContent,
} from "../../../../core/modules/workspace/index.ts";
import type { TerminalProgram } from "../../../../core/modules/terminal/index.ts";
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
async function prepareEntryChange(path: string) {
  const affected = tabs.value.filter(
    (tab) => !tab.virtual && (tab.path === path || tab.path.startsWith(path + "/")),
  );
  return (await Promise.all(affected.map((tab) => saveFile(tab)))).every(Boolean);
}
async function closeManyTabs(ids: string[]) {
  for (const id of ids) {
    await closeTab(id);
    if (tabs.value.some((tab) => tab.key === id)) break;
  }
}
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
  ++fileGeneration;
  loading.value = false;
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
const fileError = ref("");
const loading = ref(false);
const isDirty = (file: OpenFile) =>
  file.virtual === "project"
    ? !!props.projectSettingsDirty
    : !file.virtual && file.draft !== undefined && file.draft !== file.content;
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
const tabs = ref<OpenFile[]>([]);
const layout = ref<DockLayout>(createDockLayout());
const restoringSession = ref(false);
const panelHosts = createPanelHosts();
const keepAlive = new Set([virtualTabs.agent.key, virtualTabs.project.key]);
const fileOf = (id: string) => tabs.value.find((tab) => tab.key === id);
const terminalPanel = (id: string) => `terminal:${id}`;
/** Куда поместить следующую открытую вкладку: заполняется при перетаскивании файла на блок. */
let pendingTarget: DockTarget | undefined;
const lastGroup: Partial<Record<"editor" | "terminal", string>> = {};
const terminals = useTerminalSessions(() => props.projectId, {
  started: (id) => revealPanel(terminalPanel(id)),
  restarted: (previous, id) => {
    layout.value = replacePanel(layout.value, terminalPanel(previous), terminalPanel(id));
  },
});
const terminalPanels = computed(
  () => new Map(terminals.sessions.value.map((item) => [terminalPanel(item.id), item])),
);
const roleOf = (id: string) => (terminalPanels.value.has(id) ? "terminal" : "editor");
function place(id: string, current: DockLayout): DockTarget | undefined {
  if (pendingTarget) {
    const target = pendingTarget;
    pendingTarget = undefined;
    return target;
  }
  const role = roleOf(id);
  const holds = (group: DockGroup) => group.panels.some((panel) => roleOf(panel) === role);
  const groups = dockGroups(current);
  const group =
    groups.find((item) => item.id === current.focused && holds(item)) ??
    groups.find((item) => item.id === lastGroup[role]) ??
    groups.find(holds) ??
    groups.find((item) => item.role === role);
  return group
    ? { groupId: group.id, zone: "center" }
    : { zone: role === "terminal" ? "right" : "left" };
}
function reconcileLayout() {
  const keys = new Set(tabs.value.map((tab) => tab.key));
  layout.value = reconcileDock(layout.value, {
    ids: [...keys, ...terminalPanels.value.keys()],
    exists: (id) =>
      keys.has(id) || terminalPanels.value.has(id)
        ? true
        : id.startsWith("terminal:")
          ? terminals.loaded.value
            ? false
            : undefined
          : restoringSession.value
            ? undefined
            : false,
    place,
  });
}
// Вкладки и сессии — источник истины: раскладка подстраивается под них сразу, без кадра рассинхрона.
watch(
  () => [
    tabs.value.map((tab) => tab.key).join("\n"),
    terminals.sessions.value.map((item) => item.id).join("\n"),
    restoringSession.value,
    terminals.loaded.value,
  ],
  reconcileLayout,
  { flush: "sync", immediate: true },
);
const focusedGroup = computed(() => findDockGroup(layout.value, layout.value.focused));
/** Файл активной вкладки в блоке с фокусом; пусто, если там терминал или блок пуст. */
const activeKey = computed({
  get: () => {
    const id = focusedGroup.value?.active ?? "";
    return fileOf(id) ? id : "";
  },
  set: (key: string) => {
    if (key) revealPanel(key);
  },
});
function revealPanel(id: string) {
  const target = pendingTarget;
  const current = groupOfPanel(layout.value, id);
  if (current && target && (target.zone !== "center" || target.groupId !== current.id)) {
    pendingTarget = undefined;
    layout.value = movePanel(layout.value, id, target);
  } else
    layout.value = current
      ? activatePanel(layout.value, id)
      : addPanel(layout.value, id, place(id, layout.value));
  const group = groupOfPanel(layout.value, id);
  if (group) lastGroup[roleOf(id)] = group.id;
}
async function createTerminal(program: TerminalProgram) {
  const created = await terminals.create(program);
  if (created) revealPanel(terminalPanel(created.id));
}
function describePanel(id: string): DockTabInfo {
  const file = fileOf(id);
  if (file)
    return {
      id,
      label: file.virtual ? file.path : file.path.split("/").at(-1)!,
      title: file.virtual
        ? virtualTabs[file.virtual].title
        : file.saveError
          ? `${file.path} · ${file.saveError}`
          : `${file.path}${file.original !== undefined ? (file.staged ? " · HEAD → index" : " · index → рабочий файл") : ""}`,
      dirty: isDirty(file),
      saving: !!file.saving,
      error: !!file.saveError,
    };
  const item = terminalPanels.value.get(id);
  if (item)
    return {
      id,
      label: terminals.nameOf(item),
      title: `${terminals.labelOf(item)}${item.status === "running" ? (item.activity?.state === "idle" ? " · ожидает ввода" : " · есть работающие процессы") : ""} · Двойной щелчок: переименовать`,
      renameable: true,
    };
  // Сессии ещё загружаются: не показываем технический id.
  return { id, label: id.startsWith("terminal:") ? "Терминал…" : id };
}
function selectPanel(id: string) {
  if (fileOf(id)) selectTab(id);
  else revealPanel(id);
}
function closePanel(id: string) {
  const item = terminalPanels.value.get(id);
  return item ? terminals.close(item.id) : closeTab(id);
}
async function closeManyPanels(ids: string[]) {
  const files = ids.filter((id) => fileOf(id));
  await closeManyTabs(files);
  if (files.some((id) => fileOf(id))) return;
  await terminals.closeMany(
    ids.flatMap((id) => {
      const item = terminalPanels.value.get(id);
      return item ? [item.id] : [];
    }),
  );
}
function renamePanel(id: string, label: string) {
  const item = terminalPanels.value.get(id);
  if (item) void terminals.rename(item.id, label);
}
const hiddenGroups = computed(() => dockGroups(layout.value).filter((group) => group.hidden));
const roleLabels: Record<string, string> = { editor: "Редактор", terminal: "Терминалы" };
function groupLabel(group: DockGroup) {
  if (!group.panels.length) return roleLabels[group.role ?? ""] ?? "Блок";
  const label = describePanel(group.active).label;
  return group.panels.length > 1 ? `${label} +${group.panels.length - 1}` : label;
}
const showGroup = (id: string) => {
  layout.value = setGroupHidden(layout.value, id, false);
};
function resetLayout() {
  const current = activeKey.value;
  layout.value = createDockLayout();
  sidebarHidden.value = false;
  reconcileLayout();
  if (current) revealPanel(current);
}
function panelArg(value?: unknown) {
  const args = commandArgs(value);
  if (args.id !== undefined && typeof args.id !== "string")
    throw new Error("id должен быть строкой");
  return (args.id as string | undefined) ?? focusedGroup.value?.active ?? "";
}
for (const [action, title, zone] of [
  ["splitRight", "Разделить вправо", "right"],
  ["splitDown", "Разделить вниз", "bottom"],
] as const)
  registerEditor(
    `ide.workbench.panel.${action}`,
    title,
    (value) => {
      const id = panelArg(value);
      layout.value = movePanel(layout.value, id, { groupId: groupOfPanel(layout.value, id)!.id, zone });
    },
    (value) => (groupOfPanel(layout.value, panelArg(value))?.panels.length ?? 0) > 1,
  );
registerEditor(
  "ide.workbench.panel.hideGroup",
  "Скрыть блок",
  (value) => {
    layout.value = setGroupHidden(layout.value, groupOfPanel(layout.value, panelArg(value))!.id, true);
  },
  (value) => !!groupOfPanel(layout.value, panelArg(value)),
);
registerEditor(
  "ide.workbench.sidebar.toggle",
  "Показать или скрыть боковую панель",
  () => {
    sidebarHidden.value = !sidebarHidden.value;
  },
  () => true,
);
registerEditor("ide.workbench.layout.reset", "Сбросить раскладку блоков", resetLayout, () => true);
registerEditor(
  "ide.workbench.terminal.new",
  "Новый терминал",
  async (value) => {
    const { program = "shell" } = commandArgs(value);
    if (!["shell", "codex", "claude", "opencode"].includes(program as string))
      throw new Error("program: shell, codex, claude или opencode");
    await createTerminal(program as TerminalProgram);
  },
  () => !terminals.busy.value,
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
        completed !== fileGeneration
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
  for (const tab of tabs.value.filter((tab) => tab.path === paths[0])) {
    if (pendingSaves.has(tab) && !(await pendingSaves.get(tab)))
      throw new Error("Не удалось завершить сохранение файла");
  }
}
function invalidateOpening() {
  ++fileGeneration;
  loading.value = false;
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
let fileGeneration = 0;
async function openFile(
  path: string,
  line?: number,
  column?: number,
  staged?: boolean,
  reload = false,
  external = false,
) {
  const key = `${external ? "external:" : ""}${path}:${staged === undefined ? "file" : staged ? "index" : "working"}`;
  const existing = tabs.value.find((tab) => tab.key === key);
  if (existing && (!reload || isDirty(existing) || existing.saving)) {
    selectTab(key);
    existing.line = line;
    existing.column = column;
    if (line && isMarkdown(existing)) existing.markdownMode = "source";
    return fileGeneration;
  }
  const generation = ++fileGeneration;
  loading.value = true;
  fileError.value = "";
  try {
    const data =
      staged === undefined
        ? await workspaceRequest<FileContent & { image?: boolean }>(
            props.projectId,
            external ? "external" : "file",
            { path },
          )
        : await workspaceRequest<FileComparison>(props.projectId, "diff", {
            path,
            staged: String(staged),
          });
    if (generation !== fileGeneration) return;
    const file: OpenFile = {
      external,
      image:
        "image" in data && data.image
          ? `/api/projects/${encodeURIComponent(props.projectId)}/workspace/${external ? "external-asset" : "asset"}?${new URLSearchParams({ path })}`
          : undefined,
      path,
      content: "modified" in data ? data.modified : data.content,
      archive: "archive" in data ? data.archive : undefined,
      original: "original" in data ? data.original : undefined,
      staged,
      line,
      column,
      key,
      markdownMode: line ? "source" : (existing?.markdownMode ?? "document"),
    };
    const index = tabs.value.findIndex((tab) => tab.key === key);
    if (index === -1) tabs.value.push(file);
    else tabs.value[index] = file;
    selectTab(key);
    return fileGeneration;
  } catch (err) {
    if (generation === fileGeneration) {
      fileError.value = err instanceof Error ? err.message : "Не удалось открыть файл";
      return generation;
    }
  } finally {
    if (generation === fileGeneration) loading.value = false;
  }
}
let dropGeneration = 0;
function releasePreview(file: OpenFile) {
  if (file.image?.startsWith("blob:")) URL.revokeObjectURL(file.image);
}
async function openBrowserFile(source: File, reload = false) {
  const key = `browser:${source.name}:${source.size}:${source.lastModified}`;
  if (!reload && tabs.value.some((tab) => tab.key === key)) {
    selectTab(key);
    return;
  }
  const generation = ++fileGeneration;
  loading.value = true;
  fileError.value = "";
  try {
    const data = await previewBrowserFile(source);
    if (generation !== fileGeneration) {
      if (data.image) URL.revokeObjectURL(data.image);
      return;
    }
    const file: OpenFile = { ...data, key, external: true, localFile: source };
    const previous = tabs.value.findIndex((tab) => tab.key === key);
    if (previous === -1) tabs.value.push(file);
    else {
      releasePreview(tabs.value[previous]!);
      tabs.value[previous] = file;
    }
    selectTab(key);
  } catch (err) {
    if (generation === fileGeneration)
      fileError.value = err instanceof Error ? err.message : "Не удалось открыть файл";
  } finally {
    if (generation === fileGeneration) loading.value = false;
  }
}
const acceptsFileDrop = (data: DataTransfer | null) =>
  isFileDrag(data) || !!data?.types.includes(treeDragType);
async function dropFiles(event: DragEvent, target: DockTarget) {
  event.preventDefault();
  const data = event.dataTransfer;
  if (!data || (!isFileDrag(data) && !data.types.includes(treeDragType))) return;
  const generation = ++dropGeneration;
  const projectId = props.projectId;
  const paths = pathsFromDataTransfer(data);
  const files = [...data.files];
  const directories = [...data.items].some((item) => item.webkitGetAsEntry?.()?.isDirectory);
  const tree = data.getData(treeDragType);
  const current = () => generation === dropGeneration && projectId === props.projectId;
  fileError.value = "";
  pendingTarget = target;
  try {
    if (tree) {
      const entry = JSON.parse(tree) as { projectId: string; path: string };
      if (entry.projectId === projectId) {
        await openFile(entry.path);
        return;
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(entry.projectId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось прочитать проект");
      paths.push(`${result.project.path.replace(/\/+$/, "")}/${entry.path}`);
    }
    if (paths.length) {
      const { root } = await workspaceRequest<{ root: string }>(projectId, "root");
      for (const path of paths) {
        if (!current()) return;
        const relative = projectRelativePath(root, path);
        await openFile(
          relative ?? path,
          undefined,
          undefined,
          undefined,
          false,
          relative === undefined,
        );
      }
    } else {
      if (directories) throw new Error("Бросьте файл, чтобы открыть его в редакторе");
      for (const file of files) {
        if (!current()) return;
        await openBrowserFile(file);
      }
      if (!files.length) throw new Error("Не удалось прочитать перетащенный файл");
    }
  } catch (err) {
    if (current()) fileError.value = err instanceof Error ? err.message : "Не удалось открыть файл";
  } finally {
    pendingTarget = undefined;
  }
}

async function closeTab(key: string) {
  const tab = tabs.value.find((file) => file.key === key);
  if (!tab) return;
  if (tab.virtual === "project" && props.beforeCloseProjectSettings?.() === false) return;
  if (!(await saveFile(tab))) {
    revealPanel(tab.key);
    if (!window.confirm(`Не удалось сохранить ${tab.path}. Закрыть без сохранения изменений?`))
      return;
  }
  const index = tabs.value.indexOf(tab);
  if (index === -1) return;
  releasePreview(tab);
  tabs.value.splice(index, 1);
}
function selectTab(key: string) {
  if (key !== activeKey.value) void saveFile();
  ++fileGeneration;
  loading.value = false;
  fileError.value = "";
  revealPanel(key);
}
const pendingSaves = new Map<OpenFile, Promise<boolean>>();
function saveFile(file = active.value): Promise<boolean> {
  if (!file || !isEditable(file)) return Promise.resolve(true);
  const pending = pendingSaves.get(file);
  if (pending) return pending;
  if (!isDirty(file)) return Promise.resolve(true);
  file.saving = true;
  file.saveError = "";
  const projectId = props.projectId;
  const operation = (async () => {
    try {
      // If a second blur/save arrives during a write, include the latest draft.
      while (isDirty(file)) {
        const content = file.draft!;
        await saveWorkspaceFile(projectId, file.path, content, file.content);
        file.content = content;
      }
      void loadGit();
      return true;
    } catch (error) {
      file.saveError = error instanceof Error ? error.message : "Не удалось сохранить файл";
      return false;
    } finally {
      file.saving = false;
      pendingSaves.delete(file);
    }
  })();
  pendingSaves.set(file, operation);
  return operation;
}
async function canLeave() {
  const results = await Promise.all(tabs.value.map((file) => saveFile(file)));
  if (results.every(Boolean)) return true;
  return window.confirm("Не удалось сохранить изменения файлов. Уйти без сохранения?");
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate((to, from) => to.path === from.path || canLeave());
function windowBlur() {
  for (const file of tabs.value) void saveFile(file);
}
function toggleMarkdownSource() {
  const file = active.value;
  if (file && isMarkdown(file))
    file.markdownMode = file.markdownMode === "source" ? "document" : "source";
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!tabs.value.some((file) => isDirty(file) || file.saving)) return;
  event.preventDefault();
  event.returnValue = "";
}
onMounted(() => {
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("blur", windowBlur);
});
watch(
  () => props.projectId,
  () => {
    const saved = session.read();
    const generation = ++sessionGeneration;
    restoringSession.value = true;
    ++fileGeneration;
    overview.reset();
    ++dropGeneration;
    pendingTarget = undefined;
    tabs.value.forEach(releasePreview);
    tabs.value = [];
    layout.value = parseDockLayout(saved?.layout) ?? createDockLayout();
    fileError.value = "";
    loading.value = false;
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
  ++fileGeneration;
  loading.value = false;
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
  ++dropGeneration;
  tabs.value.forEach(releasePreview);
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("blur", windowBlur);
  ++fileGeneration;
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
        :invalidate="invalidateOpening"
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
