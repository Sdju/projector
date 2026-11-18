import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { usePointerDrag } from "../../../common/utilities/pointer-drag.ts";

const minTree = 160;
const minAside = 200;
const minDock = 300;
const compactWidth = 1050;
const clampTree = (width: number, total: number) =>
  Math.max(minTree, Math.min(width, total - minDock));
const clampAside = (width: number, total: number) =>
  Math.max(minAside, Math.min(width, total - minDock - 360));

/** Ширины боковых колонок: перетаскивание границ, стрелки и подгонка при изменении окна. */
export function useSidebarResize(workspace: Ref<HTMLElement | undefined>) {
  const treeWidth = ref<number>();
  const asideWidth = ref<number>();
  const sizes = computed(() => ({
    "--tree-width": treeWidth.value ? `${treeWidth.value}px` : undefined,
    "--aside-width": asideWidth.value ? `${asideWidth.value}px` : undefined,
  }));
  let sizeObserver: ResizeObserver | undefined;
  onMounted(() => {
    sizeObserver = new ResizeObserver(() => {
      const element = workspace.value;
      if (!element || window.innerWidth <= compactWidth) return;
      if (treeWidth.value !== undefined)
        treeWidth.value = clampTree(treeWidth.value, element.clientWidth);
      if (asideWidth.value !== undefined)
        asideWidth.value = clampAside(asideWidth.value, element.clientWidth);
    });
    if (workspace.value) sizeObserver.observe(workspace.value);
  });
  onBeforeUnmount(() => {
    sizeObserver?.disconnect();
  });
  const treeDrag = usePointerDrag({
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
  const asideDrag = usePointerDrag({
    start: () => {
      const element = workspace.value;
      if (!element) return;
      return element.getBoundingClientRect();
    },
    move: (event, rect) => {
      asideWidth.value = clampAside(rect.right - event.clientX, rect.width);
    },
    cursor: () => "col-resize",
  });
  const resizeTree = treeDrag.start;
  const resizeAside = asideDrag.start;
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
  function resizeAsideKey(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !workspace.value) return;
    event.preventDefault();
    const element = workspace.value;
    const amount = event.key === "ArrowLeft" ? 20 : -20;
    asideWidth.value = clampAside(
      (asideWidth.value ?? element.querySelector(".aside")!.clientWidth) + amount,
      element.clientWidth,
    );
  }
  return {
    treeWidth,
    asideWidth,
    sizes,
    resizeTree,
    resizeTreeKey,
    resizeAside,
    resizeAsideKey,
  };
}
