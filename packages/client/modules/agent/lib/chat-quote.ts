import { onBeforeUnmount, ref } from "vue";

/** A selection as a Markdown quote: one `>` per line, without empty lines at the edges. */
export function blockquote(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  return lines
    .map((line) => {
      const content = line.replace(/[ \t]+$/, "");
      return content ? `> ${content}` : ">";
    })
    .join("\n");
}

export interface ChatQuoteOptions {
  /** The element whose text can be quoted: the chat log, without the composer. */
  root: () => HTMLElement | undefined;
  /** Puts the finished quote into the chat's draft. */
  quote: (text: string) => void;
}

const BUTTON_WIDTH = 104;
const BUTTON_HEIGHT = 28;

/**
 * The «Цитировать» button of a chat selection. It appears after a drag or a keyboard selection
 * ends, beside the last selected line, and hides when the selection or its chat goes away.
 */
export function useChatQuote(options: ChatQuoteOptions) {
  const text = ref("");
  const position = ref<{ left: number; top: number }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let selecting = false;

  function hide() {
    clearTimeout(timer);
    timer = undefined;
    text.value = "";
    position.value = undefined;
  }

  /** The selected text and where to put the button, if the selection is inside the chat log. */
  function current() {
    const root = options.root();
    const selection = document.getSelection();
    if (!root || !selection || selection.isCollapsed) return undefined;
    const { anchorNode, focusNode } = selection;
    if (!anchorNode || !focusNode) return undefined;
    if (!root.contains(anchorNode) || !root.contains(focusNode)) return undefined;
    const value = selection.toString().trim();
    if (!value || !selection.rangeCount) return undefined;
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1]! : range.getBoundingClientRect();
    return {
      text: value,
      position: {
        left: Math.min(
          Math.max(8, rect.right + 8),
          Math.max(8, window.innerWidth - BUTTON_WIDTH - 8),
        ),
        top: Math.min(
          Math.max(8, rect.bottom + 8),
          Math.max(8, window.innerHeight - BUTTON_HEIGHT - 8),
        ),
      },
    };
  }

  function apply() {
    timer = undefined;
    const found = current();
    if (!found) {
      hide();
      return;
    }
    text.value = found.text;
    position.value = found.position;
  }

  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(apply, delay);
  }

  function onPointerDown(event: PointerEvent) {
    if ((event.target as Element | null)?.closest?.(".quote-selection")) return;
    selecting = true;
    hide();
  }

  function onPointerUp() {
    if (!selecting) return;
    selecting = false;
    schedule(30);
  }

  function onSelectionChange() {
    if (selecting) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      hide();
      return;
    }
    schedule(180);
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === "Escape") {
      hide();
      return;
    }
    if (
      event.shiftKey ||
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End"
    )
      schedule(120);
  }

  function add() {
    const value = blockquote(text.value);
    if (value) options.quote(value);
    document.getSelection()?.removeAllRanges();
    hide();
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("scroll", hide, true);
  onBeforeUnmount(() => {
    clearTimeout(timer);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("scroll", hide, true);
  });

  return { text, position, add, hide };
}
