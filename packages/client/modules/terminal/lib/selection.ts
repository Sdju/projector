import { onBeforeUnmount, ref, type Ref } from "vue";
import type { Terminal } from "@xterm/xterm";

export interface TerminalSelectionOptions {
  terminal: () => Terminal | undefined;
  container: Ref<HTMLElement | undefined>;
  /** Attaches the selected text to the agent chat, with a human-readable source. */
  toChat: (text: string, source: string) => void;
  source: () => string;
}

/**
 * The «В чат» button of a terminal selection. It waits until the drag ends, then sits beside the
 * pointer; a keyboard selection uses the last selected cell instead.
 */
export function useTerminalSelection(options: TerminalSelectionOptions) {
  const { terminal, container } = options;
  const text = ref("");
  const position = ref<{ left: number; top: number }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let selecting = false;
  let mouseSettledAt = 0;

  function wrapper() {
    return container.value?.closest<HTMLElement>(".screen-wrap");
  }

  /** Clamps the button to the terminal so a selection near an edge does not push it out. */
  function place(left: number, top: number) {
    const wrap = wrapper();
    if (!wrap) return undefined;
    const width = 64;
    const height = 30;
    return {
      left: Math.min(Math.max(8, left), Math.max(8, wrap.clientWidth - width - 8)),
      top: Math.min(Math.max(8, top), Math.max(8, wrap.clientHeight - height - 8)),
    };
  }

  /** A mouse release is the precise end of a drag; the button appears just beside it. */
  function pointFromMouse(event: MouseEvent) {
    const wrap = wrapper();
    if (!wrap) return undefined;
    const rect = wrap.getBoundingClientRect();
    const left = event.clientX - rect.left + 10;
    const y = event.clientY - rect.top;
    const top = y + 34 > rect.height ? y - 36 : y + 12;
    return place(left, top);
  }

  /** Keyboard selection has no pointer: use the last selected cell on screen. */
  function pointAtSelectionEnd() {
    const current = terminal();
    const selected = current?.getSelectionPosition();
    const screen = current?.element?.querySelector<HTMLElement>(".xterm-screen");
    const wrap = wrapper();
    if (!current || !selected || !screen || !wrap) return undefined;
    const rect = screen.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const row = Math.min(
      Math.max(0, selected.end.y - 1 - current.buffer.active.viewportY),
      current.rows - 1,
    );
    const cellWidth = rect.width / current.cols;
    const cellHeight = rect.height / current.rows;
    const left =
      rect.left - wrapRect.left + Math.min(selected.end.x, current.cols) * cellWidth + 10;
    const top = rect.top - wrapRect.top + (row + 1) * cellHeight + 12;
    return place(left, top);
  }

  function apply() {
    const selected = terminal()?.getSelection().trim() ?? "";
    if (!selected) {
      text.value = "";
      position.value = undefined;
      return;
    }
    if (!position.value) position.value = pointAtSelectionEnd();
    text.value = position.value ? selected : "";
  }

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(apply, delay);
  }

  /** A drag started in the terminal: hide the old button until the pointer is released. */
  function begin(event: MouseEvent) {
    if ((event.target as Element | null)?.closest?.(".selection-chat")) return;
    selecting = true;
    clearTimeout(timer);
    text.value = "";
    position.value = undefined;
  }

  function end(event: MouseEvent) {
    if (!selecting) return;
    selecting = false;
    mouseSettledAt = Date.now();
    const point = pointFromMouse(event);
    if (point) position.value = point;
    schedule(120);
  }

  /** xterm reports every step of a drag: show the button only after the selection settles. */
  function changed() {
    const selected = terminal()?.getSelection().trim() ?? "";
    if (!selected) {
      clearTimeout(timer);
      text.value = "";
      position.value = undefined;
      return;
    }
    if (selecting) {
      text.value = "";
      position.value = undefined;
      return;
    }
    if (Date.now() - mouseSettledAt > 300) position.value = undefined;
    schedule(180);
  }

  function add() {
    const selected = text.value.trim();
    if (selected) options.toChat(selected, options.source());
  }

  function dispose() {
    clearTimeout(timer);
    document.removeEventListener("mouseup", end, true);
  }

  document.addEventListener("mouseup", end, true);
  onBeforeUnmount(dispose);

  return { text, position, begin, changed, add };
}
