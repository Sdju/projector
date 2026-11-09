<script setup lang="ts">
import UiPopupSurface from "../../../common/ui/UiPopupSurface.vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import {
  chipExtensions,
  contentOf,
  deleteChipBackward,
  deleteChipForward,
  insertChip,
  setContent,
} from "../lib/composer/chips.ts";
import {
  appendChips as appendEditorChips,
  appendText as appendEditorText,
  insertChips as insertEditorChips,
  insertQuote as insertEditorQuote,
} from "../lib/composer/editing.ts";
import { useComposerDrop } from "../lib/composer/drop.ts";
import {
  triggerAt,
  useComposerSuggestions,
  type ComposerTrigger,
} from "../lib/composer/suggestions.ts";
import { messageText } from "../lib/message-parts.ts";
import type { MessageChip, MessagePart } from "../model/types.ts";

/** What the user typed as plain text; chips stand for their `@path` or `/command` text there. */
const draft = defineModel<string>({ required: true });
/** The same message with its chips; kept so a chat that is shown again still has them. */
const parts = defineModel<MessagePart[]>("parts", { default: () => [] });
const props = defineProps<{
  projectId?: string;
  commands?: { name: string; description?: string }[];
}>();
const emit = defineEmits<{ submit: []; open: [chip: MessageChip]; fail: [message: string] }>();

const host = ref<HTMLElement>();
const view = shallowRef<EditorView>();
const { acceptsDrag, dropData, pasteImages } = useComposerDrop({
  projectId: () => props.projectId,
  view,
  onFail: (message) => emit("fail", message),
});

const trigger = ref<ComposerTrigger>();
const dismissed = ref("");
const { suggestions, active } = useComposerSuggestions({
  projectId: () => props.projectId,
  commands: () => props.commands,
  trigger,
  dismissed,
});
const open = computed(() => !!trigger.value && suggestions.value.length > 0);

function accept(index = active.value): boolean {
  const target = view.value;
  const item = suggestions.value[index];
  const current = trigger.value;
  if (!target || !item || !current || !open.value) return false;
  insertChip(target, current.from, current.to, item.chip);
  suggestions.value = [];
  target.focus();
  return true;
}
function moveActive(step: number): boolean {
  if (!open.value) return false;
  active.value = (active.value + step + suggestions.value.length) % suggestions.value.length;
  host.value?.parentElement
    ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
    ?.scrollIntoView({ block: "nearest" });
  return true;
}
function dismiss(): boolean {
  if (!open.value || !trigger.value) return false;
  dismissed.value = `${trigger.value.from}:${trigger.value.query}`;
  suggestions.value = [];
  return true;
}

function commit(state: EditorState) {
  const next = contentOf(state);
  const text = messageText(next);
  if (text !== draft.value) draft.value = text;
  parts.value = next;
}

function draftContent(text: string): readonly MessagePart[] {
  if (parts.value.length && messageText(parts.value).trim() === text.trim()) return parts.value;
  return text ? [{ type: "text", text }] : [];
}

onMounted(() => {
  const submit = () => {
    if (accept()) return true;
    emit("submit");
    return true;
  };
  const editor = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        chipExtensions,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Сообщение агенту",
          "aria-multiline": "true",
          spellcheck: "true",
        }),
        placeholderText("Что нужно сделать в проекте?"),
        Prec.highest(
          keymap.of([
            { key: "ArrowDown", run: () => moveActive(1) },
            { key: "ArrowUp", run: () => moveActive(-1) },
            { key: "Tab", run: () => accept() },
            { key: "Escape", run: dismiss },
            { key: "Backspace", run: deleteChipBackward },
            { key: "Delete", run: deleteChipForward },
            { key: "Enter", run: (target) => (target.composing ? false : submit()) },
            {
              key: "Shift-Enter",
              run: (target) => {
                target.dispatch(target.state.replaceSelection("\n"), { userEvent: "input" });
                return true;
              },
            },
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.domEventHandlers({
          dragover(event) {
            if (!acceptsDrag(event.dataTransfer)) return false;
            event.preventDefault();
            // The dock behind the chat would offer to open the drop as a side panel.
            event.stopPropagation();
            event.dataTransfer!.dropEffect = "copy";
            return true;
          },
          drop(event, target) {
            const data = event.dataTransfer;
            if (!data) return false;
            const at =
              target.posAtCoords({ x: event.clientX, y: event.clientY }) ??
              target.state.selection.main.head;
            if (!dropData(data, at)) return false;
            event.preventDefault();
            event.stopPropagation();
            return true;
          },
          paste(event) {
            if (!pasteImages(event.clipboardData)) return false;
            event.preventDefault();
            return true;
          },
          mousedown(event) {
            const element = (event.target as HTMLElement).closest<HTMLElement>(".composer-chip");
            if (!element?.dataset.chip) return false;
            event.preventDefault();
            emit("open", JSON.parse(element.dataset.chip) as MessageChip);
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) commit(update.state);
          if (update.docChanged || update.selectionSet) {
            const next = triggerAt(update.state);
            const same =
              next?.kind === trigger.value?.kind &&
              next?.from === trigger.value?.from &&
              next?.query === trigger.value?.query;
            if (!same) trigger.value = next;
          }
        }),
      ],
    }),
  });
  view.value = editor;
  // A chat shown again keeps the unsent message: with chips if they are still known.
  if (draft.value || parts.value.length) setContent(editor, draftContent(draft.value));
});
onBeforeUnmount(() => {
  view.value?.destroy();
});

// The chat sets the draft too (a suggestion, an emptied field after sending): that text wins.
watch(draft, (value) => {
  const target = view.value;
  const current = target ? messageText(contentOf(target.state)) : "";
  if (!target || value === current || (value && value === current.trim())) return;
  setContent(target, draftContent(value));
});

defineExpose({
  focus: () => view.value?.focus(),
  insertChips: (chips: MessageChip[]) => {
    if (view.value) insertEditorChips(view.value, chips);
  },
  appendChips: (chips: MessageChip[]) => {
    if (view.value) appendEditorChips(view.value, chips);
  },
  appendText: (value: string) => {
    if (view.value) appendEditorText(view.value, value);
  },
  insertQuote: (value: string) => {
    if (view.value) insertEditorQuote(view.value, value);
  },
  acceptsDrag,
  dropData,
  /** Puts the cursor behind everything written. */
  end: () =>
    view.value?.dispatch({
      selection: EditorSelection.cursor(view.value.state.doc.length),
    }),
});
</script>

<template>
  <div class="agent-input">
    <div ref="host" class="editor" />
    <UiPopupSurface
      v-if="open"
      class="suggest"
      role="listbox"
      aria-label="Подсказки"
      flow="column"
      border="strong"
      radius="lg"
    >
      <button
        v-for="(item, index) in suggestions"
        :key="item.key"
        type="button"
        role="option"
        class="suggestion"
        :class="{ active: index === active }"
        :aria-selected="index === active"
        :data-index="index"
        tabindex="-1"
        @mousedown.prevent="accept(index)"
        @mousemove="active = index"
      >
        <span class="icon" aria-hidden="true" v-html="item.icon" />
        <span class="label">{{ item.label }}</span>
        <span v-if="item.detail" class="detail u-truncate" :class="{ path: item.path }">{{
          item.detail
        }}</span>
      </button>
    </UiPopupSurface>
  </div>
</template>

<style scoped>
.agent-input {
  position: relative;
  min-width: 0;
}
.editor :deep(.cm-editor) {
  background: none;
  color: var(--text);
  font: var(--fs-sm) / 1.7 var(--sans);
}
.editor :deep(.cm-editor.cm-focused) {
  outline: none;
}
.editor :deep(.cm-scroller) {
  min-height: 44px;
  max-height: 180px;
  overflow: auto;
  font-family: inherit;
  scrollbar-width: thin;
}
.editor :deep(.cm-content) {
  padding: var(--sp-3) var(--sp-3) var(--sp-1);
  caret-color: var(--text);
}
.editor :deep(.cm-line) {
  padding: 0;
}
.editor :deep(.cm-placeholder) {
  color: var(--muted);
}
.editor :deep(.cm-cursor) {
  border-left-color: var(--text);
}
.editor :deep(.cm-selectionBackground),
.editor :deep(.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground) {
  background: color-mix(in srgb, var(--focus) 30%, transparent);
}
.editor :deep(.composer-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  margin: 0 1px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text-2);
  font-size: var(--fs-xs);
  line-height: 1.5;
  vertical-align: baseline;
}
.editor :deep(.composer-chip) {
  cursor: pointer;
}
.editor :deep(.composer-chip:hover) {
  border-color: var(--focus);
  color: var(--text);
}
.editor :deep(.composer-chip svg),
.editor :deep(.chip-thumb) {
  flex-shrink: 0;
  color: var(--muted);
}

.suggest {
  position: absolute;
  z-index: var(--z-popover);
  left: 0;
  right: 0;
  bottom: calc(100% + var(--sp-2));
  max-height: 240px;
  overflow-y: auto;
  padding: var(--sp-1);
  font-size: var(--fs-xs);
}
.suggestion {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-md);
  color: var(--text-2);
  text-align: left;
}
.suggestion.active {
  background: var(--hover);
  color: var(--text);
}
.icon {
  display: flex;
  flex-shrink: 0;
  color: var(--muted);
}
.label {
  flex-shrink: 0;
}
.detail {
  min-width: 0;
  color: var(--faint);
}
.detail.path {
  direction: rtl;
  text-align: left;
}
</style>
