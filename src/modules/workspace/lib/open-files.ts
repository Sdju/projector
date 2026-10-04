import { onBeforeUnmount, ref, type Ref } from "vue";
import { isFileDrag, pathsFromDataTransfer } from "../../path-drop/index.ts";
import type { DockTarget } from "../../dock/index.ts";
import {
  workspaceRequest,
  saveWorkspaceFile,
  workspaceAssetUrl,
  workspaceCapabilities,
  type TabParams,
  type TabRegistry,
} from "../../workspace-api/index.ts";
import { projectRelativePath, previewBrowserFile } from "../file-drop.ts";
import { isEditable, isMarkdown, type OpenFile, type OpenFileOptions } from "../open-file.ts";
import { dropPreviewExcept as dropPreviewTabs, opensAsPreview } from "./preview-tabs.ts";
import { ensureTab } from "./service-tabs.ts";
import { useDirtyGuard } from "./dirty-guard.ts";
import { treeDragType } from "../modules/tree/index.ts";
import type {
  CommitComparison,
  FileComparison,
  FileContent,
} from "../../../../core/modules/workspace/index.ts";

export interface OpenFilesContext {
  projectId: () => string;
  tabs: Ref<OpenFile[]>;
  /** Файл активной вкладки в блоке с фокусом. */
  active: () => OpenFile | undefined;
  activeKey: () => string;
  /** Показывает панель; вкладка может оказаться в другом блоке. */
  reveal: (id: string) => void;
  isDirty: (file: OpenFile) => boolean;
  /** Файл записан на диск: Git и маркеры строк устарели. */
  saved: () => void;
  /** Куда поместить следующую открытую вкладку: заполняется при перетаскивании файла на блок. */
  pending: { target?: DockTarget };
  tabTypes: TabRegistry;
}

/** Открытые файлы проекта: чтение, сохранение, закрытие и приём перетаскиваемых файлов. */
export function useOpenFiles(ctx: OpenFilesContext) {
  const { tabs } = ctx;
  const fileError = ref("");
  const loading = ref(false);
  let fileGeneration = 0;
  let dropGeneration = 0;
  async function openFile(
    path: string,
    line?: number,
    column?: number,
    staged?: boolean,
    { reload = false, external = false, preview = true }: OpenFileOptions = {},
  ) {
    if (external && !workspaceCapabilities(ctx.projectId()).externalFiles)
      throw new Error("Внешние файлы недоступны для этого источника");
    const key = `${external ? "external:" : ""}${path}:${staged === undefined ? "file" : staged ? "index" : "working"}`;
    const existing = tabs.value.find((tab) => tab.key === key);
    const asPreview = opensAsPreview(preview, existing);
    if (existing && (!reload || ctx.isDirty(existing) || existing.saving)) {
      existing.preview = asPreview;
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
              ctx.projectId(),
              external ? "external" : "file",
              { path },
            )
          : await workspaceRequest<FileComparison>(ctx.projectId(), "diff", {
              path,
              staged: String(staged),
            });
      if (generation !== fileGeneration) return;
      if (asPreview) dropPreviewExcept(key);
      const file: OpenFile = {
        ...data,
        readonly: !workspaceCapabilities(ctx.projectId()).write,
        external,
        image:
          "image" in data && data.image
            ? workspaceAssetUrl(ctx.projectId(), path, external)
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
        preview: asPreview,
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
  /** Diff файла внутри коммита: родитель → коммит, только для чтения. */
  async function openCommitFile(hash: string, path: string, preview = true) {
    const key = `${path}:commit:${hash}`;
    const existing = tabs.value.find((tab) => tab.key === key);
    if (existing) {
      if (!preview) existing.preview = false;
      selectTab(key);
      return fileGeneration;
    }
    const generation = ++fileGeneration;
    loading.value = true;
    fileError.value = "";
    try {
      const data = await workspaceRequest<CommitComparison>(ctx.projectId(), "commit-diff", {
        hash,
        path,
      });
      if (generation !== fileGeneration) return;
      if (preview) dropPreviewExcept(key);
      tabs.value.push({
        key,
        path,
        content: data.modified,
        original: data.original,
        commit: data.hash,
        parent: data.parent,
        preview,
      });
      selectTab(key);
      return fileGeneration;
    } catch (err) {
      if (generation === fileGeneration) {
        fileError.value = err instanceof Error ? err.message : "Не удалось открыть изменения";
        return generation;
      }
    } finally {
      if (generation === fileGeneration) loading.value = false;
    }
  }
  /** Вкладка с подробным обзором коммита; `subject` — подсказка до загрузки деталей. */
  const openCommit = (hash: string, subject = "") => openTab("commit", { hash, subject });
  /** Открывает вкладку зарегистрированного типа (временную, если тип так задан и не `preview: false`) или фокусирует открытую. */
  function openTab(id: string, params?: TabParams, { preview = true } = {}) {
    const key = ensureTab(tabs, ctx.tabTypes, id, params, preview);
    if (!key) throw new Error(`Вкладка «${id}» недоступна в этом проекте`);
    if (tabs.value.find((tab) => tab.key === key)?.preview) dropPreviewExcept(key);
    selectTab(key);
  }
  function releasePreview(file: OpenFile) {
    if (file.image?.startsWith("blob:")) URL.revokeObjectURL(file.image);
  }
  const dropPreviewExcept = (key: string) =>
    dropPreviewTabs(tabs.value, key, ctx.isDirty, releasePreview);
  /** Двойной щелчок по вкладке предпросмотра: закрепляет её как обычную. */
  function pinPreview(key: string) {
    const file = tabs.value.find((tab) => tab.key === key);
    if (file) file.preview = false;
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
    (workspaceCapabilities(ctx.projectId()).externalFiles && isFileDrag(data)) ||
    !!data?.types.includes(treeDragType);
  async function dropFiles(event: DragEvent, target: DockTarget) {
    event.preventDefault();
    const data = event.dataTransfer;
    if (!data || (!isFileDrag(data) && !data.types.includes(treeDragType))) return;
    const generation = ++dropGeneration;
    const projectId = ctx.projectId();
    const paths = pathsFromDataTransfer(data);
    const files = [...data.files];
    const directories = [...data.items].some((item) => item.webkitGetAsEntry?.()?.isDirectory);
    const tree = data.getData(treeDragType);
    const current = () => generation === dropGeneration && projectId === ctx.projectId();
    fileError.value = "";
    ctx.pending.target = target;
    try {
      if (tree) {
        const entry = JSON.parse(tree) as { projectId: string; path: string };
        if (entry.projectId === projectId) {
          await openFile(entry.path, undefined, undefined, undefined, { preview: false });
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
          await openFile(relative ?? path, undefined, undefined, undefined, {
            external: relative === undefined,
            preview: false,
          });
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
      if (current())
        fileError.value = err instanceof Error ? err.message : "Не удалось открыть файл";
    } finally {
      ctx.pending.target = undefined;
    }
  }

  async function closeTab(key: string) {
    const tab = tabs.value.find((file) => file.key === key);
    if (!tab) return;
    if (ctx.tabTypes.behaviorOf(tab.virtual)?.beforeClose?.() === false) return;
    if (!(await saveFile(tab))) {
      ctx.reveal(tab.key);
      if (!window.confirm(`Не удалось сохранить ${tab.path}. Закрыть без сохранения изменений?`))
        return;
    }
    const index = tabs.value.indexOf(tab);
    if (index === -1) return;
    releasePreview(tab);
    tabs.value.splice(index, 1);
  }
  function selectTab(key: string) {
    if (key !== ctx.activeKey()) void saveFile();
    ++fileGeneration;
    loading.value = false;
    fileError.value = "";
    ctx.reveal(key);
  }
  const pendingSaves = new Map<OpenFile, Promise<boolean>>();
  function saveFile(file = ctx.active()): Promise<boolean> {
    if (!file || !isEditable(file)) return Promise.resolve(true);
    const pending = pendingSaves.get(file);
    if (pending) return pending;
    if (!ctx.isDirty(file)) return Promise.resolve(true);
    file.saving = true;
    file.saveError = "";
    const projectId = ctx.projectId();
    const operation = (async () => {
      try {
        // If a second blur/save arrives during a write, include the latest draft.
        while (ctx.isDirty(file)) {
          const content = file.draft!;
          await saveWorkspaceFile(projectId, file.path, content, file.content);
          file.content = content;
        }
        ctx.saved();
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
  useDirtyGuard({ tabs, saveFile, isDirty: ctx.isDirty });
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

  /** Сбрасывает незавершённое открытие файла: его ответ уже не нужен. */
  function invalidate() {
    ++fileGeneration;
    loading.value = false;
  }
  /** Ждёт записи файлов по пути; false, если запись не удалась. */
  async function settle(path: string) {
    for (const tab of tabs.value.filter((tab) => tab.path === path)) {
      if (pendingSaves.has(tab) && !(await pendingSaves.get(tab))) return false;
    }
    return true;
  }
  function toggleMarkdownSource() {
    const file = ctx.active();
    if (file && isMarkdown(file))
      file.markdownMode = file.markdownMode === "source" ? "document" : "source";
  }
  /** Сбрасывает всё при смене проекта. */
  function reset() {
    ++fileGeneration;
    ++dropGeneration;
    ctx.pending.target = undefined;
    tabs.value.forEach(releasePreview);
    tabs.value = [];
    fileError.value = "";
    loading.value = false;
  }
  onBeforeUnmount(() => {
    ++dropGeneration;
    tabs.value.forEach(releasePreview);
    ++fileGeneration;
  });
  return {
    fileError,
    loading,
    generation: () => fileGeneration,
    invalidate,
    settle,
    reset,
    openFile,
    openCommit,
    openCommitFile,
    openTab,
    openBrowserFile,
    acceptsFileDrop,
    dropFiles,
    closeTab,
    closeManyTabs,
    selectTab,
    saveFile,
    prepareEntryChange,
    toggleMarkdownSource,
    pinPreview,
  };
}
