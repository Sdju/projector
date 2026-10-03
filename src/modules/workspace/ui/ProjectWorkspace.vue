<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSessionSnapshot, workspaceSessionSchema, type WorkspaceSession } from "../session.ts";
import { workspaceRequest, searchWorkspace, saveWorkspaceFile, mutateWorkspaceGit } from "../api.ts";
import { isFileDrag, pathsFromDataTransfer } from "../../path-drop/index.ts";
import { projectRelativePath, previewBrowserFile } from "../file-drop.ts";
import { treeDragType } from "../tree-drag.ts";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { relocatedPath } from "../../../../core/modules/workspace/index.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import IconPlus from "~icons/lucide/plus";
import IconMinus from "~icons/lucide/minus";
import IconDiff from "~icons/lucide/file-diff";
import FileTree from "./FileTree.vue";
import GitChangesTree from "./GitChangesTree.vue";
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
import IconBot from "~icons/lucide/bot";
import IconKeyboard from "~icons/lucide/keyboard";
import IconSettings from "~icons/lucide/settings";
import IconRefresh from "~icons/lucide/rotate-cw";
import IconFiles from "~icons/lucide/files";
import IconSearch from "~icons/lucide/search";
import IconCaseSensitive from "~icons/lucide/case-sensitive";
import IconWholeWord from "~icons/lucide/whole-word";
import IconRegex from "~icons/lucide/regex";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconFile from "~icons/lucide/file";
import IconGit from "~icons/devicon/git";
import IconSidebar from "~icons/lucide/panel-left";
import IconLayout from "~icons/lucide/layout-template";
import IconEye from "~icons/lucide/eye";
import IconTerminal from "~icons/lucide/terminal";
import IconCodex from "~icons/simple-icons/openai";
import IconClaude from "~icons/simple-icons/claude";
import IconOpenCode from "~icons/simple-icons/opencode";
import IconRestart from "~icons/lucide/rotate-ccw";
import IconFailed from "~icons/lucide/circle-slash";
import IconFinishFlag from "../../../common/ui/IconFinishFlag.vue";
import {
  TerminalCloseDialog,
  TerminalView,
  useTerminalSessions,
} from "../../terminal/index.ts";
import type {
  SearchHit,
  GitOverview,
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
const treeWidth = ref<number>();
const sidebarHidden = ref(false);
const sizes = computed(() => ({
  "--tree-width": treeWidth.value ? `${treeWidth.value}px` : undefined,
}));
const minTree = 160;
const minDock = 300;
const clampTree = (width: number, total: number) =>
  Math.max(minTree, Math.min(width, total - minDock));
let sizeObserver: ResizeObserver | undefined;
onMounted(() => {
  sizeObserver = new ResizeObserver(() => {
    const element = workspaceElement.value;
    if (!element || window.innerWidth <= 1050 || treeWidth.value === undefined) return;
    treeWidth.value = clampTree(treeWidth.value, element.clientWidth);
  });
  if (workspaceElement.value) sizeObserver.observe(workspaceElement.value);
});
let stopResize: (() => void) | undefined;
function resizeTree(event: PointerEvent) {
  const element = workspaceElement.value;
  if (!element || window.innerWidth <= 1050) return;
  stopResize?.();
  (event.currentTarget as HTMLElement).focus();
  event.preventDefault();
  const rect = element.getBoundingClientRect();
  const move = (moveEvent: PointerEvent) => {
    treeWidth.value = clampTree(moveEvent.clientX - rect.left, rect.width);
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    stopResize = undefined;
  };
  stopResize = finish;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
function resizeTreeKey(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !workspaceElement.value) return;
  event.preventDefault();
  const element = workspaceElement.value;
  const amount = event.key === "ArrowRight" ? 20 : -20;
  treeWidth.value = clampTree(
    (treeWidth.value ?? element.querySelector(".sidebar")!.clientWidth) + amount,
    element.clientWidth,
  );
}
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
  if (query.value.trim()) void search();
}
const section = ref<"files" | "search" | "git">("files");
const revision = ref(0);
const query = ref("");
const searchCase = ref(false);
const searchWord = ref(false);
const searchRegex = ref(false);
const hits = ref<SearchHit[]>([]);
const searchError = ref("");
const searching = ref(false);
const searched = ref(false);
const truncated = ref(false);
const collapsedGroups = ref<Set<string>>(new Set());
const git = ref<GitOverview>({ available: false, branch: "", changes: [] });
const gutterRevision = ref(0);
const gitError = ref("");
const gitLoading = ref(false);
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
const terminalPrograms = [
  { program: "shell", title: "Новый shell", icon: IconTerminal },
  { program: "codex", title: "Новый Codex", icon: IconCodex },
  { program: "claude", title: "Новый Claude Code", icon: IconClaude },
  { program: "opencode", title: "Новый OpenCode", icon: IconOpenCode },
];
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
const stagedChanges = computed(() =>
  git.value.changes.filter((change) => change.index !== " " && change.index !== "?"),
);
const workingChanges = computed(() =>
  git.value.changes.filter((change) => change.worktree !== " "),
);
const gitBusy = ref(false);
const gitMenu = ref<InstanceType<typeof ContextMenu>>();
const gitTarget = ref({ path: "", staged: false });
const gitCommands = useCommandScope(`git:${props.projectId}`, () => ({
  surface: "git",
  projectId: props.projectId,
  path: gitTarget.value.path,
  staged: gitTarget.value.staged,
  busy: gitBusy.value,
}));
function gitArgs(value?: unknown) {
  const args = commandArgs(value);
  if (args.path !== undefined && typeof args.path !== "string")
    throw new Error("path должен быть строкой");
  if (args.staged !== undefined && typeof args.staged !== "boolean")
    throw new Error("staged должен быть boolean");
  return {
    path: (args.path as string | undefined) ?? gitTarget.value.path,
    staged: (args.staged as boolean | undefined) ?? gitTarget.value.staged,
    confirm: args.confirm === true,
  };
}
function gitChange(value?: unknown) {
  return git.value.changes.find((change) => change.path === gitArgs(value).path);
}
function gitSelection(value: unknown, staged: boolean) {
  const { path } = gitArgs(value);
  return (staged ? stagedChanges.value : workingChanges.value).filter(
    (change) => !path || change.path === path || change.path.startsWith(`${path}/`),
  );
}
const hasConflict = (change: GitOverview["changes"][number]) =>
  change.index === "U" ||
  change.worktree === "U" ||
  ["AA", "DD"].includes(change.index + change.worktree);
for (const [action, title] of [
  ["openDiff", "Открыть изменения"],
  ["openFile", "Открыть файл"],
  ["stage", "Отметить Staged"],
  ["unstage", "Убрать из Staged"],
  ["discard", "Откатить рабочие изменения…"],
] as const) {
  gitCommands.scope.registerCommand({
    id: `ide.git.${action}`,
    title,
    enabled: (value) => {
      if (gitBusy.value) return false;
      if (action === "stage" || action === "unstage") {
        const selection = gitSelection(value, action === "unstage");
        return (
          !!selection.length &&
          (action === "stage" || selection.every((change) => !hasConflict(change)))
        );
      }
      const change = gitChange(value);
      if (!change) return false;
      if (action === "openFile")
        return change.worktree !== "D" && !(change.index === "D" && change.worktree === " ");
      if (action === "openDiff")
        return (
          !hasConflict(change) &&
          (gitArgs(value).staged ? ![" ", "?"].includes(change.index) : change.worktree !== " ")
        );
      return change.worktree !== " " && !hasConflict(change);
    },
    run: async (value) => {
      const { path, staged, confirm } = gitArgs(value);
      if (action === "openFile" || action === "openDiff")
        return openFile(path, undefined, undefined, action === "openDiff" ? staged : undefined);
      if (
        action === "discard" &&
        !confirm &&
        !window.confirm(
          gitChange(value)?.index === "?"
            ? `Убрать новый файл ${path}? Он будет перемещён в .projector-trash.`
            : `Откатить рабочие изменения ${path} до подготовленной версии? Несохранённый черновик тоже будет удалён.`,
        )
      )
        return;
      const paths =
        action === "discard"
          ? [path]
          : gitSelection(value, action === "unstage").map((change) => change.path);
      gitBusy.value = true;
      try {
        if (action !== "discard") {
          for (const entry of paths)
            if (!(await prepareEntryChange(entry))) throw new Error("Не удалось сохранить файл");
        }
        if (action === "discard") {
          const affected = tabs.value.filter((tab) => tab.path === path);
          for (const tab of affected) {
            if (pendingSaves.has(tab) && !(await pendingSaves.get(tab)))
              throw new Error("Не удалось завершить сохранение файла");
          }
        }
        ++fileGeneration;
        loading.value = false;
        ++gitGeneration;
        gitLoading.value = false;
        git.value = await mutateWorkspaceGit(
          props.projectId,
          action,
          action === "discard" ? path : paths,
        );
        gitError.value = "";
        revision.value++;
        // Drop obsolete comparisons; reload a visible file after discard.
        const current = active.value;
        tabs.value = tabs.value.filter(
          (tab) =>
            !paths.includes(tab.path) || (tab.original === undefined && action !== "discard"),
        );
        if (current?.path === path && action === "discard") {
          const exists = await workspaceRequest<FileContent>(props.projectId, "file", {
            path,
          }).then(
            () => true,
            () => false,
          );
          if (exists) await openFile(path);
        }
        if (query.value.trim()) void search();
      } finally {
        gitBusy.value = false;
      }
    },
  });
}
gitCommands.scope.registerCommand({
  id: "ide.git.refresh",
  title: "Обновить Git",
  run: loadGit,
  enabled: () => !gitBusy.value,
});
const gitMenuItems = computed<ContextMenuItem[]>(() => {
  const args = gitTarget.value;
  const file = !!gitChange(args);
  return [
    ...(file
      ? [gitCommands.item("ide.git.openDiff", args), gitCommands.item("ide.git.openFile", args)]
      : []),
    gitCommands.item(args.staged ? "ide.git.unstage" : "ide.git.stage", args, { separator: true }),
    ...(!args.staged && file ? [gitCommands.item("ide.git.discard", args, { danger: true })] : []),
  ];
});
function gitContext(event: MouseEvent | KeyboardEvent, path: string, staged: boolean) {
  gitTarget.value = { path, staged };
  gitCommands.scope.activate();
  void gitMenu.value?.open(event);
}
let fileGeneration = 0;
let gitGeneration = 0;
let searchGeneration = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchAbort: AbortController | undefined;
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
async function loadGit() {
  const generation = ++gitGeneration;
  gutterRevision.value++;
  gitLoading.value = true;
  gitError.value = "";
  try {
    const data = await workspaceRequest<GitOverview>(props.projectId, "git");
    if (generation === gitGeneration) git.value = data;
  } catch (err) {
    if (generation === gitGeneration)
      gitError.value = err instanceof Error ? err.message : "Ошибка Git";
  } finally {
    if (generation === gitGeneration) gitLoading.value = false;
  }
}
async function search() {
  const generation = ++searchGeneration;
  searchAbort?.abort();
  searched.value = false;
  hits.value = [];
  searchError.value = "";
  truncated.value = false;
  if (!query.value.trim()) {
    searching.value = false;
    return;
  }
  searching.value = true;
  searchAbort = new AbortController();
  try {
    const data = await searchWorkspace(
      props.projectId,
      query.value,
      {
        caseSensitive: searchCase.value,
        wholeWord: searchWord.value,
        regex: searchRegex.value,
      },
      searchAbort.signal,
    );
    if (generation !== searchGeneration) return;
    hits.value = data.hits;
    truncated.value = data.truncated;
    searched.value = true;
  } catch (err) {
    if (generation === searchGeneration && !searchAbort.signal.aborted)
      searchError.value = err instanceof Error ? err.message : "Ошибка поиска";
  } finally {
    if (generation === searchGeneration) searching.value = false;
  }
}
watch(query, () => {
  clearTimeout(searchTimer);
  ++searchGeneration;
  searchAbort?.abort();
  hits.value = [];
  collapsedGroups.value = new Set();
  searched.value = false;
  searching.value = !!query.value.trim();
  searchTimer = setTimeout(() => void search(), 300);
});
watch([searchCase, searchWord, searchRegex], () => {
  clearTimeout(searchTimer);
  if (query.value.trim()) void search();
});
interface SearchGroup {
  path: string;
  name: string;
  directory: string;
  hits: SearchHit[];
}
const searchGroups = computed<SearchGroup[]>(() => {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits.value) {
    const list = groups.get(hit.path) ?? [];
    list.push(hit);
    groups.set(hit.path, list);
  }
  return [...groups.entries()].map(([path, list]) => {
    const parts = path.split("/");
    return { path, name: parts.at(-1) ?? path, directory: parts.slice(0, -1).join("/"), hits: list };
  });
});
function toggleGroup(path: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedGroups.value = next;
}
interface SnippetSegment {
  text: string;
  match: boolean;
}
function snippetSegments(hit: SearchHit): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let cursor = 0;
  for (const match of hit.matches ?? []) {
    const start = Math.max(match.start, cursor);
    if (start >= hit.text.length) break;
    if (start > cursor) segments.push({ text: hit.text.slice(cursor, start), match: false });
    segments.push({ text: hit.text.slice(start, match.end), match: true });
    cursor = Math.max(cursor, match.end);
  }
  if (cursor < hit.text.length) segments.push({ text: hit.text.slice(cursor), match: false });
  return segments;
}
watch(
  () => props.projectId,
  () => {
    const saved = session.read();
    const generation = ++sessionGeneration;
    restoringSession.value = true;
    ++fileGeneration;
    ++gitGeneration;
    git.value = { available: false, branch: "", changes: [] };
    ++searchGeneration;
    searchAbort?.abort();
    clearTimeout(searchTimer);
    ++dropGeneration;
    pendingTarget = undefined;
    tabs.value.forEach(releasePreview);
    tabs.value = [];
    layout.value = parseDockLayout(saved?.layout) ?? createDockLayout();
    fileError.value = "";
    loading.value = false;
    query.value = "";
    hits.value = [];
    collapsedGroups.value = new Set();
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
  if (section.value === "search") await search();
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
  if (query.value.trim()) void search();
}
onBeforeUnmount(() => {
  ++sessionGeneration;
  ++dropGeneration;
  tabs.value.forEach(releasePreview);
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("blur", windowBlur);
  stopResize?.();
  sizeObserver?.disconnect();
  ++fileGeneration;
  ++gitGeneration;
  ++searchGeneration;
  clearTimeout(searchTimer);
  searchAbort?.abort();
});
</script>

<template>
  <div
    ref="workspaceElement"
    class="workspace"
    :class="{ 'sidebar-hidden': sidebarHidden }"
    :style="sizes"
  >
    <div class="toolbar" role="toolbar" aria-label="Блоки и терминалы">
      <UiButton
        icon
        size="sm"
        :active="!sidebarHidden"
        :aria-pressed="!sidebarHidden"
        title="Боковая панель"
        aria-label="Боковая панель"
        data-command="ide.workbench.sidebar.toggle"
        @click="editorCommands.run('ide.workbench.sidebar.toggle')"
      >
        <IconSidebar aria-hidden="true" />
      </UiButton>
      <div class="toolbar-group" role="group" aria-label="Новая терминальная сессия">
        <UiButton
          v-for="entry in terminalPrograms"
          :key="entry.program"
          icon
          size="sm"
          :disabled="terminals.busy.value"
          :title="entry.title"
          :aria-label="entry.title"
          @click="editorCommands.run('ide.workbench.terminal.new', { program: entry.program })"
        >
          <component :is="entry.icon" aria-hidden="true" />
        </UiButton>
      </div>
      <slot name="terminal-actions" />
      <slot name="terminal-status" />
      <p v-if="terminals.error.value" class="toolbar-error" role="alert">
        {{ terminals.error.value }}
      </p>
      <div class="toolbar-spacer" />
      <UiButton
        v-for="group in hiddenGroups"
        :key="group.id"
        variant="chip"
        size="sm"
        :title="`Показать блок: ${groupLabel(group)}`"
        :aria-label="`Показать блок: ${groupLabel(group)}`"
        @click="showGroup(group.id)"
      >
        <IconEye aria-hidden="true" />{{ groupLabel(group) }}
      </UiButton>
      <UiButton
        icon
        size="sm"
        title="Сбросить раскладку блоков"
        aria-label="Сбросить раскладку блоков"
        data-command="ide.workbench.layout.reset"
        @click="editorCommands.run('ide.workbench.layout.reset')"
      >
        <IconLayout aria-hidden="true" />
      </UiButton>
    </div>
    <p v-if="fileError" class="file-error" role="alert">{{ fileError }}</p>
    <aside v-show="!sidebarHidden" class="sidebar" aria-label="Обзор проекта">
      <nav class="side-tabs" aria-label="Разделы проекта">
        <button
          :class="{ selected: section === 'files' }"
          :aria-pressed="section === 'files'"
          title="Файлы"
          aria-label="Файлы"
          @click="section = 'files'"
        >
          <IconFiles aria-hidden="true" />
        </button>
        <button
          :class="{ selected: section === 'search' }"
          :aria-pressed="section === 'search'"
          title="Поиск"
          aria-label="Поиск"
          @click="section = 'search'"
        >
          <IconSearch aria-hidden="true" />
        </button>
        <button
          :class="{ selected: section === 'git' }"
          :aria-pressed="section === 'git'"
          title="Git"
          :aria-label="git.changes.length ? `Git: ${git.changes.length} изменений` : 'Git'"
          @click="section = 'git'"
        >
          <IconGit class="git-logo" aria-hidden="true" />
          <span v-if="git.changes.length" aria-hidden="true">{{ git.changes.length }}</span>
        </button>
        <div class="side-actions">
          <UiButton
            icon
            size="sm"
            title="Чат с агентом"
            aria-label="Чат с агентом"
            data-command="ide.workbench.agent.open"
            @click="editorCommands.run('ide.workbench.agent.open')"
          >
            <IconBot aria-hidden="true" />
          </UiButton>
          <UiButton
            icon
            size="sm"
            title="Горячие клавиши"
            aria-label="Горячие клавиши"
            data-command="ide.workbench.keybindings.open"
            @click="editorCommands.run('ide.workbench.keybindings.open')"
          >
            <IconKeyboard aria-hidden="true" />
          </UiButton>
          <UiButton
            icon
            size="sm"
            title="Обновить обзор"
            aria-label="Обновить обзор"
            @click="section === 'git' ? gitCommands.run('ide.git.refresh') : refresh()"
          >
            <IconRefresh aria-hidden="true" />
          </UiButton>
          <UiButton
            icon
            size="sm"
            :active="active?.virtual === 'project'"
            :aria-pressed="active?.virtual === 'project'"
            title="Настройки проекта"
            aria-label="Настройки проекта"
            @click="openProjectSettings"
          >
            <IconSettings aria-hidden="true" />
          </UiButton>
        </div>
      </nav>
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
      <div v-show="section === 'search'" class="side-content search-panel">
        <form class="search-form" @submit.prevent="search">
          <div class="search-box">
            <input
              v-model="query"
              type="search"
              placeholder="Найти в проекте…"
              aria-label="Поиск по содержимому"
              maxlength="200"
            />
            <div class="search-options" role="group" aria-label="Параметры поиска">
              <UiButton
                icon
                size="sm"
                :active="searchCase"
                :aria-pressed="searchCase"
                title="Учитывать регистр"
                aria-label="Учитывать регистр"
                @click="searchCase = !searchCase"
              >
                <IconCaseSensitive aria-hidden="true" />
              </UiButton>
              <UiButton
                icon
                size="sm"
                :active="searchWord"
                :aria-pressed="searchWord"
                title="Только слово целиком"
                aria-label="Только слово целиком"
                @click="searchWord = !searchWord"
              >
                <IconWholeWord aria-hidden="true" />
              </UiButton>
              <UiButton
                icon
                size="sm"
                :active="searchRegex"
                :aria-pressed="searchRegex"
                title="Использовать регулярное выражение"
                aria-label="Использовать регулярное выражение"
                @click="searchRegex = !searchRegex"
              >
                <IconRegex aria-hidden="true" />
              </UiButton>
            </div>
          </div>
        </form>
        <p v-if="searching" class="notice" role="status">поиск…</p>
        <p v-if="searchError" class="notice error" role="alert">{{ searchError }}</p>
        <p v-if="searched" class="notice">
          {{
            hits.length
              ? `${hits.length} совпадений в ${searchGroups.length} файлах${truncated ? " · показаны первые 200" : ""}`
              : "Совпадений нет"
          }}
        </p>
        <div v-for="group in searchGroups" :key="group.path" class="result-group">
          <button
            class="result-group-header"
            type="button"
            :aria-expanded="!collapsedGroups.has(group.path)"
            :title="group.path"
            @click="toggleGroup(group.path)"
          >
            <IconChevronDown v-if="!collapsedGroups.has(group.path)" aria-hidden="true" />
            <IconChevronRight v-else aria-hidden="true" />
            <IconFile class="result-file-icon" aria-hidden="true" />
            <span class="result-file">{{ group.name }}</span>
            <span v-if="group.directory" class="result-dir">{{ group.directory }}</span>
            <span class="result-count">{{ group.hits.length }}</span>
          </button>
          <template v-if="!collapsedGroups.has(group.path)">
            <button
              v-for="hit in group.hits"
              :key="`${hit.path}:${hit.line}:${hit.column}`"
              class="result"
              :title="`${hit.path}:${hit.line}`"
              @click="openFile(hit.path, hit.line, hit.column)"
            >
              <span class="result-line">{{ hit.line }}</span>
              <span class="snippet"
                ><template v-for="(segment, index) in snippetSegments(hit)" :key="index"
                  ><mark v-if="segment.match">{{ segment.text }}</mark
                  ><template v-else>{{ segment.text }}</template></template
                ></span
              >
            </button>
          </template>
        </div>
      </div>
      <div
        v-show="section === 'git'"
        class="side-content"
        @focusin="gitCommands.scope.activate()"
        @keydown="gitCommands.keydown($event)"
      >
        <p v-if="git.available" class="notice">{{ git.branch }}</p>
        <p v-if="gitLoading" class="notice" role="status">загрузка Git…</p>
        <p v-if="gitError" class="notice error" role="alert">{{ gitError }}</p>
        <p v-else-if="!gitLoading && !git.available" class="notice">
          В этой папке нет Git-репозитория.
        </p>
        <p v-else-if="!gitLoading && !git.changes.length" class="notice">Нет изменений.</p>
        <template
          v-for="group in [
            { label: 'Staged', rows: stagedChanges, staged: true },
            { label: 'Changed', rows: workingChanges, staged: false },
          ]"
          :key="group.label"
        >
          <div v-if="git.available" class="git-group">
            <h3>
              {{ group.label }} <span v-if="group.rows.length">{{ group.rows.length }}</span>
            </h3>
            <UiButton
              v-if="group.rows.length"
              icon
              size="sm"
              :disabled="
                !gitCommands.scope.describe(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
                  path: '',
                })?.enabled
              "
              :title="group.staged ? 'Убрать всё из Staged' : 'Отметить всё Staged'"
              :aria-label="group.staged ? 'Убрать всё из Staged' : 'Отметить всё Staged'"
              :data-command="group.staged ? 'ide.git.unstage' : 'ide.git.stage'"
              @click="
                gitCommands.run(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
                  path: '',
                  staged: group.staged,
                })
              "
            >
              <IconMinus v-if="group.staged" aria-hidden="true" /><IconPlus
                v-else
                aria-hidden="true"
              />
            </UiButton>
          </div>
          <GitChangesTree
            v-if="group.rows.length"
            :key="`${projectId}:${group.staged}`"
            :changes="group.rows"
            :staged="group.staged"
            :disabled="gitBusy"
            :can-toggle="
              (path) =>
                !!gitCommands.scope.describe(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
                  path,
                })?.enabled
            "
            :selected="active?.staged === group.staged ? active.path : ''"
            @change="
              gitCommands.run(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
                path: $event,
                staged: group.staged,
              })
            "
            @target="gitTarget = { path: $event, staged: group.staged }"
            @open="gitCommands.run('ide.git.openDiff', { path: $event, staged: group.staged })"
            @context="(event, path) => gitContext(event, path, group.staged)"
          />
        </template>
        <ContextMenu ref="gitMenu" :items="gitMenuItems" label="Действия Git" />
      </div>
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
.git-group {
  display: flex;
  align-items: center;
  padding: 6px var(--sp-3) 2px var(--sp-3);
}
.git-group h3 {
  flex: 1;
  padding: 0;
}

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
.toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
  min-height: 40px;
  padding: 0 var(--sp-3);
  border-bottom: 1px solid var(--line);
  background: var(--bg-sunken);
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: var(--sp-2);
  border-left: 1px solid var(--line);
}
.toolbar-spacer {
  flex: 1;
}
.toolbar-error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
.toolbar :deep(svg) {
  width: 14px;
  height: 14px;
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
.side-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  align-items: stretch;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
}
.side-tabs > button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-width: 24px;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--muted);
  border-bottom: 2px solid transparent;
  transition: color var(--t-fast);
}
.side-tabs > button:hover {
  color: var(--text);
}
.side-tabs > button.selected {
  color: var(--text);
  border-color: var(--focus);
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
  flex-shrink: 0;
}
.side-tabs > button svg {
  width: 14px;
  height: 14px;
}
.git-logo :deep(path) {
  fill: currentColor;
}
.project-settings {
  container-type: inline-size;
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.side-tabs span {
  color: var(--run);
  font: var(--fs-2xs) var(--mono);
}
.side-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.search-panel form {
  margin: 2px 10px var(--sp-2);
}
.search-box {
  display: flex;
  align-items: center;
  gap: 2px;
}
.search-box input {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
}
.search-options {
  display: flex;
  gap: 2px;
}

.notice {
  padding: 0 var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
.result-group {
  border-bottom: 1px solid var(--line);
}
.result-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  color: var(--muted);
}
.result-group-header:hover {
  background: var(--hover);
}
.result-group-header > svg:first-child {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.result-file-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.result-file {
  font-size: var(--fs-xs);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-dir {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-2xs);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 1px 5px;
  text-align: center;
  font: var(--fs-2xs) var(--mono);
  color: var(--text);
  background: var(--bg-4);
  border-radius: var(--r-lg);
}
.result {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px var(--sp-3);
  width: 100%;
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.result:hover {
  background: var(--hover);
}
.result-line {
  flex-shrink: 0;
  min-width: 2ch;
  text-align: right;
  font: var(--fs-2xs) var(--mono);
  color: var(--faint);
}
.snippet {
  flex: 1;
  min-width: 0;
  font: var(--fs-2xs) var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet mark {
  color: inherit;
  background: var(--search);
  border-radius: var(--r-sm);
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
  .side-tabs {
    gap: 8px;
    padding: 0 8px;
  }
  .side-tabs > button {
    font-size: var(--fs-2xs);
  }
}
</style>
