<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import WorkspaceTabs from "../../../common/ui/WorkspaceTabs.vue";
import FileTree from "./FileTree.vue";
import GitChangesTree from "./GitChangesTree.vue";
import ArchiveViewer from "./ArchiveViewer.vue";
import ImageViewport from "./ImageViewport.vue";
import { KeybindingsEditor } from "../../ide/index.ts";
import { AgentChat } from "../../agent/index.ts";
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
import { TerminalPane } from "../../terminal/index.ts";
import type {
  FileContent,
  SearchHit,
  GitOverview,
  FileComparison,
} from "../../../../core/modules/workspace/index.ts";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const MarkdownViewer = defineAsyncComponent(() => import("./MarkdownViewer.vue"));
const SvgViewer = defineAsyncComponent(() => import("./SvgViewer.vue"));
const props = defineProps<{
  projectId: string;
  projectSettingsDirty?: boolean;
  beforeCloseProjectSettings?: () => boolean;
  saveProjectSettings?: () => void | Promise<void>;
}>();
const workspaceElement = ref<HTMLElement>();
const treeWidth = ref<number>();
const agentWidth = ref<number>();
const sizes = computed(() => ({
  "--tree-width": treeWidth.value ? `${treeWidth.value}px` : undefined,
  "--agent-width": agentWidth.value ? `${agentWidth.value}px` : undefined,
}));
let sizeObserver: ResizeObserver | undefined;
onMounted(() => {
  sizeObserver = new ResizeObserver(() => {
    const element = workspaceElement.value;
    if (!element || window.innerWidth <= 1050) return;
    const width = element.clientWidth;
    if (treeWidth.value !== undefined)
      treeWidth.value = Math.max(160, Math.min(treeWidth.value, width - 300 - 268));
    if (agentWidth.value !== undefined)
      agentWidth.value = Math.max(
        300,
        Math.min(agentWidth.value, width - element.querySelector(".sidebar")!.clientWidth - 268),
      );
  });
  if (workspaceElement.value) sizeObserver.observe(workspaceElement.value);
});
let stopResize: (() => void) | undefined;
function resizePane(event: PointerEvent, pane: "tree" | "agent") {
  const element = workspaceElement.value;
  if (!element || window.innerWidth <= 1050) return;
  stopResize?.();
  (event.currentTarget as HTMLElement).focus();
  event.preventDefault();
  const rect = element.getBoundingClientRect();
  const move = (moveEvent: PointerEvent) => {
    if (pane === "tree")
      treeWidth.value = Math.max(
        160,
        Math.min(
          moveEvent.clientX - rect.left,
          rect.width -
            (agentWidth.value ?? element.querySelector(".agent-pane")!.clientWidth) -
            268,
        ),
      );
    else
      agentWidth.value = Math.max(
        300,
        Math.min(
          rect.right - moveEvent.clientX,
          rect.width - (treeWidth.value ?? element.querySelector(".sidebar")!.clientWidth) - 268,
        ),
      );
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
function resizeKey(event: KeyboardEvent, pane: "tree" | "agent") {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !workspaceElement.value) return;
  event.preventDefault();
  const element = workspaceElement.value;
  const amount = event.key === "ArrowRight" ? 20 : -20;
  if (pane === "tree")
    treeWidth.value = Math.max(
      160,
      Math.min(
        (treeWidth.value ?? element.querySelector(".sidebar")!.clientWidth) + amount,
        element.clientWidth - element.querySelector(".agent-pane")!.clientWidth - 268,
      ),
    );
  else
    agentWidth.value = Math.max(
      300,
      Math.min(
        (agentWidth.value ?? element.querySelector(".agent-pane")!.clientWidth) - amount,
        element.clientWidth - element.querySelector(".sidebar")!.clientWidth - 268,
      ),
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
  if (tabs.value.find((tab) => tab.key === id)?.virtual) return [];
  return [
    ...(tabs.value.find((tab) => tab.key === id)?.original !== undefined
      ? [editorCommands.item("ide.editor.file.open", { id })]
      : []),
    editorCommands.item("ide.editor.file.save", { id }, { separator: true }),
    editorCommands.item("ide.editor.file.reveal", { id }),
    editorCommands.item("ide.editor.file.copyRelativePath", { id }),
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
  if (!(event.target as Element).closest(".keybindings-editor, .project-settings-form"))
    editorCommands.keydown(event);
}
function editorFocus(event: FocusEvent) {
  if (!(event.target as Element)?.closest(".workspace-tabs, .keybindings-editor"))
    editorCommands.scope.activate();
}
function entryDeleted(path: string) {
  ++fileGeneration;
  loading.value = false;
  tabs.value = tabs.value.filter(
    (tab) => tab.virtual || (tab.path !== path && !tab.path.startsWith(path + "/")),
  );
  if (!tabs.value.some((tab) => tab.key === activeKey.value))
    activeKey.value = tabs.value.at(-1)?.key ?? "";
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
interface OpenFile extends FileContent {
  virtual?: "keybindings" | "agent" | "project";
  external?: boolean;
  image?: string;
  localFile?: File;
  original?: string;
  staged?: boolean;
  line?: number;
  column?: number;
  key: string;
  draft?: string;
  markdownMode?: "document" | "source";
  saving?: boolean;
  saveError?: string;
}
const isEditable = (file: OpenFile) =>
  !file.virtual && !file.external && !file.image && !file.archive && file.original === undefined;
const isMarkdown = (file: OpenFile) => isEditable(file) && /\.(?:md|markdown)$/i.test(file.path);
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
const activeKey = ref("");
const restoringSession = ref(false);
const session = useSessionSnapshot(
  () => `projector:workspace:v1:${props.projectId}`,
  () => ({
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
    agentWidth: agentWidth.value,
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
    if (generation === sessionGeneration && tabs.value.some((tab) => tab.key === saved?.activeKey))
      activeKey.value = saved!.activeKey;
    if (generation === sessionGeneration && saved?.section === "project") openProjectSettings();
  } finally {
    if (generation === sessionGeneration) restoringSession.value = false;
  }
}

const fileTabs = computed(() =>
  tabs.value.map((tab) => ({
    id: tab.key,
    label: tab.virtual ? tab.path : tab.path.split("/").at(-1)!,
    title: tab.virtual
      ? virtualTabs[tab.virtual].title
      : tab.saveError
        ? `${tab.path} · ${tab.saveError}`
        : `${tab.path}${tab.original !== undefined ? (tab.staged ? " · HEAD → index" : " · index → рабочий файл") : ""}`,
    dirty: isDirty(tab),
    saving: !!tab.saving,
    error: !!tab.saveError,
  })),
);
function reorderTabs(ids: string[]) {
  const files = new Map(tabs.value.map((tab) => [tab.key, tab]));
  tabs.value = ids.map((id) => files.get(id)!);
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
        if (!tabs.value.some((tab) => tab.key === activeKey.value))
          activeKey.value = tabs.value.at(-1)?.key ?? "";
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
const draggingFiles = ref(false);
let dropGeneration = 0;
function fileDrag(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer) && !event.dataTransfer?.types.includes(treeDragType)) return;
  event.preventDefault();
  draggingFiles.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}
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
async function dropFiles(event: DragEvent) {
  draggingFiles.value = false;
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
  }
}

async function closeTab(key: string) {
  const tab = tabs.value.find((file) => file.key === key);
  if (!tab) return;
  if (tab.virtual === "project" && props.beforeCloseProjectSettings?.() === false) return;
  if (!(await saveFile(tab))) {
    activeKey.value = tab.key;
    if (!window.confirm(`Не удалось сохранить ${tab.path}. Закрыть без сохранения изменений?`))
      return;
  }
  const index = tabs.value.indexOf(tab);
  if (index === -1) return;
  releasePreview(tab);
  tabs.value.splice(index, 1);
  if (key === activeKey.value)
    activeKey.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.key ?? "";
}
function selectTab(key: string) {
  if (key !== activeKey.value) void saveFile();
  ++fileGeneration;
  loading.value = false;
  fileError.value = "";
  activeKey.value = key;
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
    draggingFiles.value = false;
    tabs.value.forEach(releasePreview);
    tabs.value = [];
    activeKey.value = "";
    fileError.value = "";
    loading.value = false;
    query.value = "";
    hits.value = [];
    collapsedGroups.value = new Set();
    section.value = saved?.section === "project" ? "files" : (saved?.section ?? "files");
    treeWidth.value = saved?.treeWidth;
    agentWidth.value = saved?.agentWidth;
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
    const wasActive = tab.key === activeKey.value;
    tab.path = path;
    tab.key = `${path}:file`;
    if (wasActive) activeKey.value = tab.key;
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
    :class="{ 'chat-active': active?.virtual === 'agent', 'project-settings-active': active?.virtual === 'project' }"
    :style="sizes"
  >
    <aside class="sidebar" aria-label="Обзор проекта">
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
      class="resize-handle tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина дерева файлов"
      tabindex="0"
      @pointerdown="resizePane($event, 'tree')"
      @keydown="resizeKey($event, 'tree')"
    />
    <section
      class="editor-pane"
      aria-label="Файлы и изменения"
      @dragenter.stop="fileDrag"
      @dragover.stop="fileDrag"
      @dragleave.stop="
        !($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node) &&
        (draggingFiles = false)
      "
      @drop.stop="dropFiles"
      @focusin="editorFocus"
      @keydown.capture="editorKeydown"
    >
      <div v-if="draggingFiles" class="file-drop-hint">Бросьте файл — откроем его</div>
      <WorkspaceTabs
        v-if="tabs.length"
        :tabs="fileTabs"
        :active-id="activeKey"
        label="Открытые файлы"
        command-namespace="ide.editor.tabs"
        :project-id="projectId"
        :command-handlers="{
          select: selectTab,
          close: closeTab,
          closeMany: closeManyTabs,
          reorder: reorderTabs,
        }"
        close-saved
        :actions="tabActions"
      >
        <template #icon="{ tab }">
          <IconDiff
            v-if="tabs.find((file) => file.key === tab.id)?.original !== undefined"
            class="diff-tab-icon"
            aria-label="Изменения"
          />
        </template>
      </WorkspaceTabs>
      <div v-if="active && active.virtual !== 'agent'" class="breadcrumb">
        <span>{{ active.path }}</span>
        <span v-if="active.virtual === 'keybindings'">настройки IDE</span>
        <span v-if="active.external">только просмотр</span>
        <span v-if="active.original !== undefined">{{
          active.staged ? "HEAD → index" : "index → рабочий файл"
        }}</span>
      </div>
      <p v-if="fileError" class="file-error" role="alert">{{ fileError }}</p>
      <p v-if="active?.saveError && !isMarkdown(active)" class="file-error" role="alert">
        {{ active.saveError }}
      </p>
      <div class="editor-body" :aria-busy="loading">
        <p v-if="loading" class="loading" role="status">читаю файл…</p>
        <UiEmpty v-if="!active && !loading" class="editor-empty">
          Откройте файл из дерева или перетащите его сюда
        </UiEmpty>
        <AgentChat
          v-if="tabs.some((tab) => tab.virtual === 'agent')"
          v-show="active?.virtual === 'agent'"
          :key="projectId"
          :project-id="projectId"
        />
        <div
          v-if="tabs.some((tab) => tab.virtual === 'project')"
          v-show="active?.virtual === 'project'"
          class="project-settings"
        >
          <slot name="project" />
        </div>
        <KeybindingsEditor v-if="active?.virtual === 'keybindings'" />
        <ImageViewport
          v-else-if="active?.image"
          :key="active.key"
          :src="active.image"
          :alt="active.path"
        />
        <ArchiveViewer v-else-if="active?.archive" :key="active.key" :archive="active.archive" />
        <SvgViewer
          v-else-if="active && /\.svg$/i.test(active.path) && active.original === undefined"
          :key="active.key"
          :path="active.path"
          :content="active.draft ?? active.content"
          :editable="isEditable(active)"
          :line="active.line"
          :column="active.column"
          @change="active.draft = $event"
          @save="saveFile"
        />
        <MarkdownViewer
          v-else-if="active && isMarkdown(active)"
          :key="active.key"
          :project-id="projectId"
          :path="active.path"
          :content="active.draft ?? active.content"
          :mode="active.markdownMode ?? 'document'"
          :error="active.saveError"
          :line="active.line"
          :column="active.column"
          @change="active.draft = $event"
          @mode="active.markdownMode = $event"
          @save="saveFile"
          @open="openFile($event)"
        />
        <CodeViewer
          v-else-if="active && !active.virtual"
          :path="active.path"
          :project-id="projectId"
          :revision="gutterRevision"
          :content="active.draft ?? active.content"
          :editable="isEditable(active)"
          @change="active.draft = $event"
          @save="saveFile"
          :original="active.original"
          :line="active.line"
          :column="active.column"
        />
      </div>
    </section>
    <div
      class="resize-handle agent-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина терминала"
      tabindex="0"
      @pointerdown="resizePane($event, 'agent')"
      @keydown="resizeKey($event, 'agent')"
    />
    <aside class="agent-pane" aria-label="Агент и терминал">
      <TerminalPane
        :key="projectId"
        :project-id="projectId"
        embedded
        @open="
          (path, line, column, external) => openFile(path, line, column, undefined, false, external)
        "
      >
        <template #actions><slot name="terminal-actions" /></template>
        <template #status><slot name="terminal-status" /></template>
      </TerminalPane>
    </aside>
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
.file-drop-hint {
  position: absolute;
  inset: 4px;
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  border: 1px dashed var(--focus);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  color: var(--text);
  pointer-events: none;
}

.workspace {
  display: grid;
  grid-template-columns:
    var(--tree-width, clamp(200px, 19vw, 280px)) 1px minmax(260px, 1fr)
    1px var(--agent-width, clamp(370px, 34vw, 680px));
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  height: calc(100dvh - 84px);
  min-height: 440px;
  overflow: hidden;
}
.sidebar,
.agent-pane,
.editor-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
.agent-pane {
  background: var(--bg-2);
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
.breadcrumb {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: var(--sp-2) var(--sp-3);
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.breadcrumb span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.breadcrumb span:last-child {
  flex-shrink: 0;
  color: var(--faint);
}
.editor-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.file-error {
  margin: 0;
  padding: var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
  border-bottom: 1px solid var(--line);
}
.loading {
  position: absolute;
  top: 4px;
  right: 14px;
  z-index: 2;
  background: var(--bg-2);
  padding: 6px var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.editor-body .editor-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 0;
}
@media (max-width: 1050px) {
  .workspace {
    grid-template-columns: 190px minmax(250px, 1fr);
    height: auto;
    min-height: 0;
  }
  .resize-handle {
    display: none;
  }
  .sidebar {
    border-right: 1px solid var(--line);
  }
  .sidebar,
  .editor-pane {
    height: 65dvh;
    min-height: 400px;
  }
  .agent-pane {
    grid-column: 1 / -1;
    height: 450px;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
@media (max-width: 600px) {
  .workspace {
    grid-template-columns: 145px minmax(0, 1fr);
  }
  .workspace.chat-active,
  .workspace.project-settings-active {
    grid-template-columns: minmax(0, 1fr);
  }
  .workspace.chat-active .sidebar,
  .workspace.project-settings-active .sidebar {
    display: none;
  }
  .workspace.chat-active .editor-pane,
  .workspace.project-settings-active .editor-pane {
    height: calc(100dvh - 85px);
    min-height: 440px;
  }
  .side-tabs {
    gap: 8px;
    padding: 0 8px;
  }
  .side-tabs > button {
    font-size: var(--fs-2xs);
  }
  .breadcrumb span:last-child {
    display: none;
  }
}
</style>
