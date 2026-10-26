import { ref } from "vue";
import { useEventListener } from "@vueuse/core";

interface DropTarget {
  acceptsDrag: (data: DataTransfer | null) => boolean;
  dropData: (data: DataTransfer) => boolean;
}

/** Files dropped anywhere on the chat go into the message, not into a new side panel of the dock. */
export function chatDropHandlers(target: () => DropTarget | undefined) {
  const over = ref(false);
  const clear = () => (over.value = false);
  useEventListener(window, "dragend", clear);
  useEventListener(window, "drop", clear, true);
  const accept = (event: DragEvent) => {
    if (!target()?.acceptsDrag(event.dataTransfer)) return false;
    event.preventDefault();
    // The dock behind the chat would otherwise highlight a new panel zone.
    event.stopPropagation();
    return true;
  };
  return {
    over,
    dragenter(event: DragEvent) {
      if (accept(event)) over.value = true;
    },
    dragover(event: DragEvent) {
      if (!accept(event)) return;
      over.value = true;
      event.dataTransfer!.dropEffect = "copy";
    },
    dragleave(event: DragEvent) {
      const root = event.currentTarget as HTMLElement;
      if (!root.contains(event.relatedTarget as Node | null)) over.value = false;
    },
    drop(event: DragEvent) {
      over.value = false;
      if (!accept(event)) return;
      target()!.dropData(event.dataTransfer!);
    },
  };
}
