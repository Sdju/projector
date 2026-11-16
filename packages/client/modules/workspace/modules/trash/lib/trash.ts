import { reactive, ref, type Ref } from "vue";
import type {
  TrashEntry,
  TrashMutation,
  TrashNode,
  TrashSize,
} from "@ai-projector/core/modules/workspace/index.ts";
import {
  listWorkspaceTrash,
  listWorkspaceTrashDirectory,
  mutateWorkspaceTrash,
  workspaceTrashSizes,
} from "../../../../workspace-api/index.ts";

/** Entry counts by project: the sidebar badge reads them without owning the list. */
const counts = reactive<Record<string, number>>({});
export const trashCount = (projectId: string) => counts[projectId] ?? 0;

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось прочитать корзину";
const topId = (key: string) => key.split("/")[0]!;

export interface TrashOptions {
  /** Sizes are only requested while the panel is selected: the rail mounts all panels at once. */
  sizes?: () => boolean;
}

/**
 * The trash tree of one project. The listing is cheap; nested levels, recursive folder sizes
 * and their caches are loaded only when the tree asks for them.
 */
export function useTrash(projectId: () => string, options: TrashOptions = {}) {
  const wantSizes = options.sizes ?? (() => true);
  const entries = ref<TrashEntry[]>([]) as Ref<TrashEntry[]>;
  const loading = ref(false);
  const busy = ref(false);
  const error = ref("");
  const expanded = reactive(new Set<string>());
  const children = reactive(new Map<string, TrashNode[]>());
  const childrenTruncated = reactive(new Set<string>());
  const childrenLoading = reactive(new Set<string>());
  const childrenError = reactive(new Map<string, string>());
  const sizes = reactive(new Map<string, TrashSize>());
  const sizing = reactive(new Set<string>());
  const sized = reactive(new Set<string>());
  const retried = new Set<string>();
  let generation = 0;

  function clearDetails() {
    expanded.clear();
    children.clear();
    childrenTruncated.clear();
    childrenLoading.clear();
    childrenError.clear();
    sizes.clear();
    sizing.clear();
    sized.clear();
    retried.clear();
  }

  /** Drops tree levels and sizes of entries that left the trash. */
  function prune(next: TrashEntry[]) {
    const ids = new Set(next.map((entry) => entry.id));
    for (const key of expanded) if (!ids.has(topId(key))) expanded.delete(key);
    for (const key of children.keys()) if (!ids.has(topId(key))) children.delete(key);
    for (const key of childrenTruncated) if (!ids.has(topId(key))) childrenTruncated.delete(key);
    for (const key of childrenError.keys()) if (!ids.has(topId(key))) childrenError.delete(key);
    for (const key of sizes.keys()) if (!ids.has(topId(key))) sizes.delete(key);
    for (const key of sized) if (key && !ids.has(topId(key))) sized.delete(key);
  }

  function publish(id: string, next: TrashEntry[]) {
    const previous = new Set(entries.value.map((entry) => entry.id));
    entries.value = next;
    counts[id] = next.length;
    prune(next);
    const added = next.some((entry) => !previous.has(entry.id));
    if (wantSizes() && (!sized.has("") || added)) void loadSizes("");
  }

  async function load(): Promise<TrashEntry[]> {
    const id = projectId();
    const current = ++generation;
    loading.value = true;
    error.value = "";
    try {
      const data = await listWorkspaceTrash(id);
      if (current !== generation) return entries.value;
      publish(id, data.entries);
      return data.entries;
    } catch (err) {
      if (current === generation) error.value = message(err);
      return entries.value;
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  async function loadSizes(path: string) {
    if (sizing.has(path) || sized.has(path)) return;
    const id = projectId();
    sizing.add(path);
    sized.add(path);
    try {
      const data = await workspaceTrashSizes(id, path);
      if (id !== projectId()) return;
      for (const size of data.sizes) sizes.set(size.key, size);
      // A scan under heavy disk load may stop at the time limit; one retry usually completes it.
      if (!retried.has(path) && data.sizes.some((size) => size.truncated || size.size === null)) {
        retried.add(path);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (id !== projectId()) return;
        const again = await workspaceTrashSizes(id, path);
        if (id !== projectId()) return;
        for (const size of again.sizes) sizes.set(size.key, size);
      }
    } catch {
      // Sizes are secondary: the tree works without them and the refresh button retries.
    } finally {
      sizing.delete(path);
    }
  }

  async function loadChildren(key: string) {
    if (childrenLoading.has(key)) return;
    childrenLoading.add(key);
    childrenError.delete(key);
    try {
      const data = await listWorkspaceTrashDirectory(projectId(), key);
      children.set(key, data.entries);
      if (data.truncated) childrenTruncated.add(key);
      else childrenTruncated.delete(key);
      if (!sized.has(key)) void loadSizes(key);
    } catch (err) {
      childrenError.set(key, message(err));
    } finally {
      childrenLoading.delete(key);
    }
  }

  function toggle(key: string) {
    if (expanded.has(key)) {
      expanded.delete(key);
      return;
    }
    expanded.add(key);
    if (!children.has(key)) void loadChildren(key);
    else if (!sized.has(key)) void loadSizes(key);
  }

  async function mutate(
    action: "restore" | "delete" | "empty",
    ids: string[] = [],
    confirm = false,
  ): Promise<TrashMutation> {
    if (busy.value) throw new Error("Дождитесь завершения операции с корзиной");
    const id = projectId();
    busy.value = true;
    error.value = "";
    try {
      const data = await mutateWorkspaceTrash(id, action, ids, confirm);
      if (id === projectId()) {
        if (action === "empty") clearDetails();
        publish(id, data.entries);
      }
      return data;
    } catch (err) {
      error.value = message(err);
      throw err;
    } finally {
      busy.value = false;
    }
  }

  /** Full re-read: drops nested levels and sizes so folders are measured again. */
  function refresh() {
    clearDetails();
    return load();
  }

  function reset() {
    ++generation;
    clearDetails();
    entries.value = [];
    loading.value = false;
    busy.value = false;
    error.value = "";
    counts[projectId()] = 0;
  }

  return {
    entries,
    loading,
    busy,
    error,
    expanded,
    children,
    childrenTruncated,
    childrenLoading,
    childrenError,
    sizes,
    sizing,
    sized,
    load,
    refresh,
    reset,
    toggle,
    restore: (ids: string[]) => mutate("restore", ids),
    remove: (ids: string[]) => mutate("delete", ids, true),
    empty: () => mutate("empty", [], true),
  };
}
