import { ref, type InjectionKey } from "vue";

export function createTreeDrag() {
  const source = ref("");
  const target = ref<string>();
  const busy = ref(false);
  const error = ref("");
  const message = ref("");
  const expanded = ref(new Set<string>());
  /** Подсказка у дерева во время перетаскивания: куда именно упадёт запись. */
  const hint = ref("");
  /** Загрузка файлов из браузера: сколько отправлено и как её прервать. */
  const progress = ref<{ done: number; total: number; cancel: () => void }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hover(path?: string, expand = false) {
    if (target.value === path) return;
    clearTimeout(timer);
    target.value = path;
    if (expand && path !== undefined) timer = setTimeout(() => expanded.value.add(path), 650);
  }
  function clear() {
    hint.value = "";
    hover();
    clearTimeout(timer);
    source.value = "";
  }
  return { source, target, busy, error, message, expanded, hint, progress, hover, clear };
}
export const treeDragKey: InjectionKey<ReturnType<typeof createTreeDrag>> = Symbol("tree-drag");
export const treeDragType = "application/x-projector-tree-entry";

/** Ближайший предок, который прокручивается по вертикали. */
function scrollParent(element: HTMLElement | null) {
  for (let node = element; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight)
      return node;
  }
}
const EDGE = 36;
/** Прокручивает дерево, пока курсор перетаскивания у верхнего или нижнего края окна просмотра. */
export function autoScrollDuringDrag(event: DragEvent) {
  const parent = scrollParent(event.currentTarget as HTMLElement | null);
  if (!parent) return;
  const box = parent.getBoundingClientRect();
  const top = EDGE - (event.clientY - box.top);
  const bottom = EDGE - (box.bottom - event.clientY);
  if (top > 0) parent.scrollTop -= Math.ceil(top / 3);
  else if (bottom > 0) parent.scrollTop += Math.ceil(bottom / 3);
}
