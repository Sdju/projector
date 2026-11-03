import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { usePointerDrag } from "../../../common/utilities/pointer-drag.ts";

const minTree = 160;
const minDock = 300;
const compactWidth = 1050;
const clampTree = (width: number, total: number) =>
  Math.max(minTree, Math.min(width, total - minDock));

/** Ширина бокового дерева: перетаскивание границы, стрелки и подгонка при изменении окна. */
export function useSidebarResize(workspace: Ref<HTMLElement | undefined>) {
  const treeWidth = ref<number>();
  const sizes = computed(() => ({
    "--tree-width": treeWidth.value ? `${treeWidth.value}px` : undefined,
  }));
  let sizeObserver: ResizeObserver | undefined;
  onMounted(() => {
    sizeObserver = new ResizeObserver(() => {
      const element = workspace.value;
      if (!element || window.innerWidth <= compactWidth || treeWidth.value === undefined) return;
      treeWidth.value = clampTree(treeWidth.value, element.clientWidth);
    });
    if (workspace.value) sizeObserver.observe(workspace.value);
  });
  onBeforeUnmount(() => {
    sizeObserver?.disconnect();
  });
  const drag = usePointerDrag({
    start: () => {
      const element = workspace.value;
      if (!element || window.innerWidth <= compactWidth) return;
      return element.getBoundingClientRect();
    },
    move: (event, rect) => {
      treeWidth.value = clampTree(event.clientX - rect.left, rect.width);
    },
    cursor: () => "col-resize",
  });
  const resizeTree = drag.start;
  function resizeTreeKey(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !workspace.value) return;
    event.preventDefault();
    const element = workspace.value;
    const amount = event.key === "ArrowRight" ? 20 : -20;
    treeWidth.value = clampTree(
      (treeWidth.value ?? element.querySelector(".sidebar")!.clientWidth) + amount,
      element.clientWidth,
    );
  }
  return { treeWidth, sizes, resizeTree, resizeTreeKey };
}
