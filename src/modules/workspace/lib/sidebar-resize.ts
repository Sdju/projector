import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

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
  let stopResize: (() => void) | undefined;
  onMounted(() => {
    sizeObserver = new ResizeObserver(() => {
      const element = workspace.value;
      if (!element || window.innerWidth <= compactWidth || treeWidth.value === undefined) return;
      treeWidth.value = clampTree(treeWidth.value, element.clientWidth);
    });
    if (workspace.value) sizeObserver.observe(workspace.value);
  });
  onBeforeUnmount(() => {
    stopResize?.();
    sizeObserver?.disconnect();
  });
  function resizeTree(event: PointerEvent) {
    const element = workspace.value;
    if (!element || window.innerWidth <= compactWidth) return;
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
