import { ref } from "vue";
import { useEventListener } from "@vueuse/core";

interface DropTarget {
  acceptsDrag: (data: DataTransfer | null) => boolean;
  dropData: (data: DataTransfer) => boolean;
  beginDrag?: () => void;
  endDrag?: () => void;
}

/** Files dropped anywhere on the chat go into the message, not into a new side panel of the dock. */
export function chatDropHandlers(target: () => DropTarget | undefined) {
  const over = ref(false);
  const clear = () => {
    over.value = false;
    target()?.endDrag?.();
  };
  useEventListener(window, "dragend", clear);
  // Capture-drop only hides the hint. Ending the drag here would unfreeze the
  // caret before the composer reads it, and a (0,0) drop would then win.
  useEventListener(
    window,
    "drop",
    () => {
      over.value = false;
    },
    true,
  );
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
      if (!accept(event)) return;
      // Snapshot the caret before dragover: drop events often report (0,0).
      target()?.beginDrag?.();
      over.value = true;
    },
    dragover(event: DragEvent) {
      if (!accept(event)) return;
      target()?.beginDrag?.();
      over.value = true;
      event.dataTransfer!.dropEffect = "copy";
    },
    dragleave(event: DragEvent) {
      const root = event.currentTarget as HTMLElement;
      if (!root.contains(event.relatedTarget as Node | null)) {
        over.value = false;
        target()?.endDrag?.();
      }
    },
    drop(event: DragEvent) {
      over.value = false;
      if (!accept(event)) return;
      target()!.dropData(event.dataTransfer!);
      target()?.endDrag?.();
    },
  };
}
