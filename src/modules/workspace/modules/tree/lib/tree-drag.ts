import { ref, type InjectionKey } from "vue";

export function createTreeDrag() {
  const source = ref("");
  const target = ref<string>();
  const busy = ref(false);
  const error = ref("");
  const message = ref("");
  const expanded = ref(new Set<string>());
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hover(path?: string, expand = false) {
    if (target.value === path) return;
    clearTimeout(timer);
    target.value = path;
    if (expand && path !== undefined) timer = setTimeout(() => expanded.value.add(path), 650);
  }
  function clear() {
    hover();
    clearTimeout(timer);
    source.value = "";
  }
  return { source, target, busy, error, message, expanded, hover, clear };
}
export const treeDragKey: InjectionKey<ReturnType<typeof createTreeDrag>> = Symbol("tree-drag");
export const treeDragType = "application/x-projector-tree-entry";
