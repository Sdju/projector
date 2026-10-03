import { ref, type InjectionKey } from "vue";

export function selectTreeRange(
  current: ReadonlySet<string>,
  anchor: string,
  path: string,
  visible: string[],
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  const start = visible.indexOf(anchor);
  const end = visible.indexOf(path);
  if (modifiers.shiftKey && start >= 0 && end >= 0) {
    const paths = additive ? new Set(current) : new Set<string>();
    for (const value of visible.slice(Math.min(start, end), Math.max(start, end) + 1))
      paths.add(value);
    return { paths, anchor };
  }
  const paths = additive ? new Set(current) : new Set<string>();
  if (additive && paths.has(path)) paths.delete(path);
  else paths.add(path);
  return { paths, anchor: path };
}

// A selected directory already includes its descendants in filesystem operations.
export function topLevelTreePaths(paths: Iterable<string>) {
  const values = [...paths];
  return values.filter((path) => !values.some((parent) => path.startsWith(parent + "/")));
}

export function createTreeSelection() {
  const paths = ref(new Set<string>());
  const anchor = ref("");
  const dragged = ref<string[]>([]);
  function replace(path = "") {
    paths.value = new Set(path ? [path] : []);
    anchor.value = path;
  }
  function relocate(source: string, destination?: string) {
    const update = (path: string) =>
      path === source || path.startsWith(source + "/")
        ? destination === undefined
          ? ""
          : destination + path.slice(source.length)
        : path;
    paths.value = new Set([...paths.value].map(update).filter(Boolean));
    anchor.value = update(anchor.value);
  }
  return { paths, anchor, dragged, replace, relocate };
}

export const treeSelectionKey: InjectionKey<ReturnType<typeof createTreeSelection>> =
  Symbol("tree-selection");
