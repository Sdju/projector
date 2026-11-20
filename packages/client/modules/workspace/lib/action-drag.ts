import { ref, watch, type Ref } from "vue";

export function useActionDrag<Source, Id extends string | undefined>({
  dragging,
  axis,
  mime,
  sourceFor,
  canDrop,
  move,
}: {
  dragging: Ref<Source | undefined>;
  axis: "x" | "y";
  mime: string;
  sourceFor: (id: string) => Source;
  canDrop: (source: Source, id: Id) => boolean;
  move: (source: Source, id: Id, after: boolean) => void;
}) {
  const dropTarget = ref<{ id: string | undefined; after: boolean }>();
  watch(dragging, () => (dropTarget.value = undefined), { flush: "sync" });

  function endDrag() {
    dragging.value = undefined;
    dropTarget.value = undefined;
  }

  function dragLeave(event: DragEvent) {
    if (
      !(event.relatedTarget instanceof Node) ||
      !(event.currentTarget as HTMLElement).contains(event.relatedTarget)
    )
      dropTarget.value = undefined;
  }

  function dragOver(event: DragEvent, id: Id) {
    const source = dragging.value;
    const transfer = event.dataTransfer;
    if (source === undefined || !transfer?.types.includes(mime) || !canDrop(source, id)) {
      dropTarget.value = undefined;
      return;
    }
    event.preventDefault();
    transfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after =
      axis === "x"
        ? event.clientX > rect.left + rect.width / 2
        : event.clientY > rect.top + rect.height / 2;
    dropTarget.value = { id, after };
    return { source, after };
  }

  function dragStart(event: DragEvent, id: string) {
    dragging.value = sourceFor(id);
    if (event.dataTransfer) {
      event.dataTransfer.setData(mime, id);
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function drop(event: DragEvent, id: Id) {
    const target = dragOver(event, id);
    if (!target) return;
    move(target.source, id, target.after);
    endDrag();
  }

  return { dropTarget, dragStart, dragOver, dragLeave, drop, endDrag };
}
