import { commandArgs, type CommandScope } from "../../../../../common/utilities/commands.ts";
import { ref, watch, onBeforeUnmount, nextTick, type Ref, type InjectionKey } from "vue";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import {
  TREE_PAGE_SIZE,
  type TreePage,
  type FileEntry,
} from "../../../../../../core/modules/workspace/index.ts";

export function createTreePaging() {
  const revealPath = ref("");
  const directories = new Map<
    string,
    { more: () => Promise<string | undefined>; available: () => boolean }
  >();
  return { revealPath, directories };
}
export const treePagingKey: InjectionKey<ReturnType<typeof createTreePaging>> =
  Symbol("tree-paging");

export function useTreeListing(
  props: { projectId: string; path: string; revision: number },
  paging: ReturnType<typeof createTreePaging>,
  removed: (path: string) => void,
) {
  const entries = ref<FileEntry[]>([]);
  const total = ref(0);
  const nextOffset = ref<number | null>(null);
  const loading = ref(false);
  const error = ref("");
  let generation = 0;
  let controller: AbortController | undefined;
  let identity = "";
  function revealChild() {
    const target = paging.revealPath.value;
    const prefix = props.path ? `${props.path}/` : "";
    if (!target || !target.startsWith(prefix)) return "";
    const name = target.slice(prefix.length).split("/")[0];
    return name ? prefix + name : "";
  }
  async function load(append = false) {
    if (append && (loading.value || nextOffset.value === null)) return;
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    loading.value = true;
    error.value = "";
    const nextIdentity = `${props.projectId}\0${props.path}`;
    if (identity !== nextIdentity) {
      entries.value = [];
      total.value = 0;
      nextOffset.value = null;
      identity = nextIdentity;
    }
    const previous = entries.value;
    const offset = append ? nextOffset.value! : 0;
    const count = append ? TREE_PAGE_SIZE : Math.max(TREE_PAGE_SIZE, previous.length);
    const reveal = !append ? revealChild() || previous.at(-1)?.path || "" : "";
    try {
      const data = await workspaceRequest<TreePage>(
        props.projectId,
        "tree",
        {
          path: props.path,
          offset: String(offset),
          limit: String(Math.min(count, 1000)),
          ...(reveal ? { reveal } : {}),
        },
        controller.signal,
      );
      if (current !== generation) return;
      const next = append ? [...previous, ...data.entries] : data.entries;
      entries.value = [...new Map(next.map((entry) => [entry.path, entry])).values()];
      total.value = data.total ?? entries.value.length;
      nextOffset.value = data.nextOffset ?? null;
      if (!append) {
        const remaining = new Set(entries.value.map((entry) => entry.path));
        for (const entry of previous) if (!remaining.has(entry.path)) removed(entry.path);
      }
      return append ? data.entries[0]?.path : undefined;
    } catch (value) {
      if (current === generation) error.value = value instanceof Error ? value.message : "Ошибка";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  const handle = {
    more: () => load(true),
    available: () => !loading.value && nextOffset.value !== null,
  };
  watch(
    () => props.path,
    (path, old) => {
      if (old !== undefined && paging.directories.get(old) === handle)
        paging.directories.delete(old);
      paging.directories.set(path, handle);
    },
    { immediate: true },
  );
  watch(
    () => [props.projectId, props.path, props.revision, revealChild()],
    () => void load(),
    { immediate: true },
  );
  onBeforeUnmount(() => {
    ++generation;
    controller?.abort();
    if (paging.directories.get(props.path) === handle) paging.directories.delete(props.path);
  });
  return { entries, total, nextOffset, loading, error };
}

export function registerTreePagingCommand(
  scope: CommandScope,
  paging: ReturnType<typeof createTreePaging>,
  tree: Ref<HTMLElement | undefined>,
  busy: Ref<boolean>,
  currentPath: () => string,
) {
  const pagePath = (args?: unknown) => {
    const path = commandArgs(args).path;
    if (path !== undefined && typeof path !== "string") throw new Error("path должен быть строкой");
    return path ?? currentPath();
  };
  scope.registerCommand({
    id: "ide.fileTree.directory.loadMore",
    title: "Показать следующую порцию файлов",
    description:
      "Загружает следующие 30 дочерних элементов раскрытой папки дерева. Пустой path означает корень проекта.",
    arguments: { path: "string (необязательно): путь раскрытой папки относительно проекта" },
    enabled: (args) => !busy.value && !!paging.directories.get(pagePath(args))?.available(),
    run: async (args) => {
      const first = await paging.directories.get(pagePath(args))?.more();
      if (!first) return;
      await nextTick();
      const row = tree.value?.querySelector<HTMLButtonElement>(
        `button[data-path="${CSS.escape(first)}"]`,
      );
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    },
  });
}
