<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { isFileDrag, pathsFromDataTransfer } from "../../path-drop/index.ts";
import { findWorkspacePaths, workspaceRequest } from "../../workspace-api/index.ts";
import {
  chipExtensions,
  chipIcon,
  contentOf,
  deleteChipBackward,
  deleteChipForward,
  insertChip,
  setContent,
} from "../lib/composer/chips.ts";
import { chipText, messageText } from "../lib/message-parts.ts";
import type { MessageChip, MessagePart } from "../model/types.ts";

/** What the user typed as plain text; chips stand for their `@path` or `/command` text there. */
const draft = defineModel<string>({ required: true });
/** The same message with its chips; kept so a chat that is shown again still has them. */
const parts = defineModel<MessagePart[]>("parts", { default: () => [] });
const props = defineProps<{
  projectId?: string;
  commands?: { name: string; description?: string }[];
}>();
const emit = defineEmits<{ submit: []; open: [chip: MessageChip] }>();

const host = ref<HTMLElement>();
const view = shallowRef<EditorView>();

/** The word being completed: `@query` anywhere, `/query` only as the first thing written. */
interface Trigger {
  kind: "file" | "command";
  query: string;
  from: number;
  to: number;
}
interface Suggestion {
  key: string;
  label: string;
  detail?: string;
  chip: MessageChip;
  icon: string;
}
const trigger = ref<Trigger>();
const suggestions = ref<Suggestion[]>([]);
const active = ref(0);
const dismissed = ref("");

function triggerAt(state: EditorState): Trigger | undefined {
  const { main } = state.selection;
  if (!main.empty) return undefined;
  const line = state.doc.lineAt(main.head);
  const before = line.text.slice(0, main.head - line.from);
  const file = /(?:^|\s)@([^\s@"]*)$/.exec(before);
  if (file) {
    const query = file[1]!;
    return { kind: "file", query, from: main.head - query.length - 1, to: main.head };
  }
  const command = /^\/([^\s/]*)$/.exec(before);
  if (command && line.number === 1)
    return { kind: "command", query: command[1]!, from: line.from, to: main.head };
  return undefined;
}

let search: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
async function refresh() {
  const current = trigger.value;
  search?.abort();
  clearTimeout(timer);
  if (!current || dismissed.value === `${current.from}:${current.query}`) {
    suggestions.value = [];
    return;
  }
  if (current.kind === "command") {
    const query = current.query.toLowerCase();
    suggestions.value = (props.commands ?? [])
      .filter((command) => command.name.toLowerCase().includes(query))
      .slice(0, 30)
      .map((command) => ({
        key: command.name,
        label: `/${command.name}`,
        detail: command.description,
        chip: { type: "command", name: command.name },
        icon: chipIcon({ type: "command", name: command.name }),
      }));
    active.value = 0;
    return;
  }
  if (!props.projectId) return;
  const controller = (search = new AbortController());
  timer = setTimeout(async () => {
    try {
      const found = await findWorkspacePaths(props.projectId!, current.query, controller.signal);
      if (controller.signal.aborted) return;
      suggestions.value = found.map((item) => {
        const chip: MessageChip = { type: "file", path: item.path, directory: item.directory };
        return {
          key: item.path,
          label: item.path.split("/").pop() || item.path,
          detail: item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "",
          chip,
          icon: chipIcon(chip),
        };
      });
      active.value = 0;
    } catch {
      if (!controller.signal.aborted) suggestions.value = [];
    }
  }, 60);
}
watch(trigger, refresh, { deep: true });
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

// The project folder, to show dropped absolute paths relative to it.
let root = "";
async function loadRoot() {
  if (!props.projectId) return;
  try {
    root = (await workspaceRequest<{ root: string }>(props.projectId, "root")).root;
  } catch {
    root = "";
  }
}
function chipForPath(path: string): MessageChip {
  const inside = root && path.startsWith(`${root}/`);
  return { type: "file", path: inside ? path.slice(root.length + 1) : path };
}
function droppedChips(data: DataTransfer): MessageChip[] {
  const entry = data.getData("application/x-projector-tree-entry");
  if (entry) {
    try {
      const value = JSON.parse(entry) as { projectId?: unknown; path?: unknown; paths?: unknown };
      if (value.projectId !== props.projectId) return [];
      const paths = Array.isArray(value.paths) && value.paths.length ? value.paths : [value.path];
      return paths
        .filter((path): path is string => typeof path === "string" && !!path)
        .map((path): MessageChip => ({ type: "file", path }));
    } catch {
      return [];
    }
  }
  return pathsFromDataTransfer(data).map(chipForPath);
}
function insertDropped(target: EditorView, chips: MessageChip[], at: number) {
  let position = at;
  for (const chip of chips) {
    insertChip(target, position, position, chip);
    position += chipText(chip).length + 1;
  }
}

function commit(state: EditorState) {
  const next = contentOf(state);
  const text = messageText(next);
  if (text !== draft.value) draft.value = text;
  parts.value = next;
}

onMounted(() => {
  void loadRoot();
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
            const data = event.dataTransfer;
            if (!data) return false;
            if (!isFileDrag(data) && !data.types.includes("application/x-projector-tree-entry"))
              return false;
            event.preventDefault();
            data.dropEffect = "copy";
            return true;
          },
          drop(event, target) {
            const data = event.dataTransfer;
            if (!data) return false;
            const chips = droppedChips(data);
            if (!chips.length) return false;
            event.preventDefault();
            insertDropped(
              target,
              chips,
              target.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                target.state.selection.main.head,
            );
            target.focus();
            return true;
          },
          mousedown(event) {
            const element = (event.target as HTMLElement).closest<HTMLElement>(".composer-chip");
            if (!element?.dataset.chip || !(event.metaKey || event.ctrlKey)) return false;
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
  if (parts.value.length && messageText(parts.value) === draft.value)
    setContent(editor, parts.value);
  else if (draft.value) setContent(editor, [{ type: "text", text: draft.value }]);
});
onBeforeUnmount(() => {
  search?.abort();
  clearTimeout(timer);
  view.value?.destroy();
});

// The chat sets the draft too (a suggestion, an emptied field after sending): that text wins.
watch(draft, (value) => {
  const target = view.value;
  if (!target || value === messageText(contentOf(target.state))) return;
  setContent(target, value ? [{ type: "text", text: value }] : []);
});

function insertChips(chips: MessageChip[]) {
  const target = view.value;
  if (!target) return;
  insertDropped(target, chips, target.state.selection.main.head);
  target.focus();
}
defineExpose({
  focus: () => view.value?.focus(),
  insertChips,
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
    <div v-if="open" class="suggest" role="listbox" aria-label="Подсказки">
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
        <span v-if="item.detail" class="detail">{{ item.detail }}</span>
      </button>
    </div>
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
.editor :deep(.composer-chip svg) {
  flex-shrink: 0;
  color: var(--muted);
}
.editor :deep(.composer-chip-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggest {
  position: absolute;
  z-index: var(--z-popover);
  left: 0;
  right: 0;
  bottom: calc(100% + var(--sp-2));
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
  padding: var(--sp-1);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  box-shadow: var(--shadow-popover);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--faint);
  direction: rtl;
  text-align: left;
}
</style>
