<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconFolder from "~icons/lucide/folder";
import { fetchDirectories } from "../api/client.ts";
import type { DirectoryEntry } from "../../../../core/modules/directories/index.ts";

const props = defineProps<{ path: string; navigate: (path: string) => Promise<void> }>();
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const editing = ref(false);
const value = ref("");
const menuPath = ref<string | null>(null);
const entries = ref<DirectoryEntry[]>([]);
const selected = ref(-1);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const truncated = ref(false);
const scroll = ref(0);
const caretAtEnd = ref(true);
const listId = useId();
let request: AbortController | undefined;
let generation = 0;
let disposed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const open = computed(() => editing.value || menuPath.value !== null);
const segments = computed(() => {
  const parts = props.path.split("/").filter(Boolean);
  return [
    { name: "/", path: "/" },
    ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` })),
  ];
});
const candidate = computed(() => entries.value[selected.value < 0 ? 0 : selected.value]);
const completion = computed(() => {
  if (!editing.value || !caretAtEnd.value || !candidate.value) return "";
  const name = candidate.value.name;
  const slash = value.value.lastIndexOf("/");
  const prefix = value.value.slice(slash + 1);
  if (value.value === "~") return "";
  return name.startsWith(prefix) ? name.slice(prefix.length) + "/" : "";
});
function invalidate() {
  clearTimeout(timer);
  ++generation;
  request?.abort();
  loading.value = false;
}
async function load(path: string, complete: boolean) {
  invalidate();
  const current = generation;
  request = new AbortController();
  loading.value = true;
  entries.value = [];
  selected.value = -1;
  error.value = "";
  truncated.value = false;
  try {
    const data = await fetchDirectories(path, complete, request.signal);
    if (current !== generation) return;
    entries.value = data.entries;
    truncated.value = data.truncated;
  } catch (err) {
    if (current === generation)
      error.value = err instanceof Error ? err.message : "Не удалось прочитать папку";
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function edit(path = props.path) {
  if (busy.value) return;
  menuPath.value = null;
  editing.value = true;
  value.value = path;
  scroll.value = 0;
  caretAtEnd.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.setSelectionRange(path.length, path.length);
  void load(path, true);
}
function close() {
  if (busy.value) return;
  invalidate();
  editing.value = false;
  menuPath.value = null;
  error.value = "";
}
function toggle(path: string) {
  if (busy.value) return;
  if (menuPath.value === path) {
    close();
    return;
  }
  editing.value = false;
  menuPath.value = path;
  void load(path, false);
}
function syncCaret() {
  scroll.value = input.value?.scrollLeft ?? 0;
  caretAtEnd.value =
    input.value?.selectionStart === value.value.length &&
    input.value?.selectionEnd === value.value.length;
}
function changed() {
  invalidate();
  entries.value = [];
  selected.value = -1;
  error.value = "";
  loading.value = true;
  syncCaret();
  timer = setTimeout(() => void load(value.value, true), 100);
}
async function accept() {
  if (!completion.value) return;
  value.value += completion.value;
  await nextTick();
  input.value?.setSelectionRange(value.value.length, value.value.length);
  syncCaret();
  void load(value.value, true);
}
async function navigate(path: string) {
  if (busy.value) return;
  invalidate();
  busy.value = true;
  error.value = "";
  try {
    const data = await fetchDirectories(path);
    if (disposed) return;
    await props.navigate(data.path);
    busy.value = false;
    close();
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>(".segment:last-of-type .segment-label")?.focus();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось открыть папку";
  } finally {
    busy.value = false;
    if (editing.value && !disposed) {
      await nextTick();
      input.value?.focus();
    }
  }
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || busy.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (entries.value.length) {
      selected.value =
        (selected.value +
          (event.key === "ArrowDown" ? 1 : selected.value < 0 ? 0 : -1) +
          entries.value.length) %
        entries.value.length;
      void nextTick(() =>
        document
          .getElementById(`${listId}-${selected.value}`)
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
  } else if (
    editing.value &&
    ((event.key === "Tab" && !event.shiftKey) ||
      (event.key === "ArrowRight" && caretAtEnd.value)) &&
    completion.value
  ) {
    event.preventDefault();
    void accept();
  } else if (event.key === "Enter" && (editing.value || selected.value >= 0)) {
    event.preventDefault();
    void navigate(selected.value >= 0 && candidate.value ? candidate.value.path : value.value);
  }
}
async function focusout(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return;
  // Switching to input removes the focused breadcrumb button. Wait for its replacement to receive focus.
  await nextTick();
  if (root.value?.contains(document.activeElement)) return;
  close();
}
watch(
  () => props.path,
  () => {
    if (!busy.value) close();
  },
);
watch(completion, async () => {
  await nextTick();
  if (input.value && caretAtEnd.value)
    input.value.scrollLeft = input.value.scrollWidth - input.value.clientWidth;
  syncCaret();
});
watch(
  [() => props.path, editing],
  async () => {
    await nextTick();
    const segments = root.value?.querySelector<HTMLElement>(".segments");
    if (segments) segments.scrollLeft = segments.scrollWidth;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  invalidate();
});
</script>

<template>
  <div ref="root" class="path-bar" :aria-busy="busy" @keydown="keydown" @focusout="focusout">
    <IconFolder class="path-icon" aria-hidden="true" />
    <div v-if="!editing" class="segments">
      <span v-for="segment in segments" :key="segment.path" class="segment">
        <button
          class="segment-label"
          :title="segment.path"
          :disabled="busy"
          @click="edit(segment.path)"
        >
          {{ segment.name }}
        </button>
        <button
          class="segment-arrow"
          :aria-label="`Папки в ${segment.path}`"
          :aria-expanded="menuPath === segment.path"
          aria-haspopup="listbox"
          :aria-controls="listId"
          :disabled="busy"
          @click="toggle(segment.path)"
        >
          <IconChevronRight aria-hidden="true" />
        </button>
      </span>
      <button class="edit-space" aria-label="Ввести путь" :disabled="busy" @click="edit()" />
    </div>
    <div v-else class="input-wrap">
      <div class="completion" aria-hidden="true">
        <span :style="{ transform: `translateX(${-scroll}px)` }"
          ><span class="typed">{{ value }}</span
          >{{ completion }}</span
        >
      </div>
      <input
        ref="input"
        v-model="value"
        role="combobox"
        aria-label="Путь к папке"
        aria-autocomplete="both"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="selected >= 0 ? `${listId}-${selected}` : undefined"
        :disabled="busy"
        :style="{ paddingRight: completion ? `${Math.min(completion.length, 20)}ch` : undefined }"
        autocomplete="off"
        spellcheck="false"
        @input="changed"
        @scroll="syncCaret"
        @click="syncCaret"
        @keyup="syncCaret"
        @select="syncCaret"
      />
    </div>
    <span v-if="editing" class="key-hint" aria-hidden="true">Tab · Enter</span>
    <div v-if="open" class="dropdown">
      <div class="dropdown-heading">{{ editing ? "Перейти в папку" : menuPath }}</div>
      <p v-if="loading" class="notice" role="status">Читаю папки…</p>
      <p v-else-if="error" class="notice error" role="alert">{{ error }}</p>
      <p v-else-if="!entries.length" class="notice">
        {{ editing ? "Подходящих папок нет" : "Нет вложенных папок" }}
      </p>
      <div :id="listId" role="listbox" aria-label="Доступные папки" class="options">
        <button
          v-for="(entry, index) in entries"
          :id="`${listId}-${index}`"
          :key="entry.path"
          role="option"
          :aria-selected="selected === index"
          :class="{ highlighted: selected === index }"
          :disabled="busy"
          :title="entry.path"
          @pointerdown.prevent
          @click="navigate(entry.path)"
        >
          <IconFolder aria-hidden="true" /><span>{{ entry.name }}</span
          ><IconChevronRight aria-hidden="true" />
        </button>
      </div>
      <p v-if="truncated" class="notice">Первые 1000 папок — уточните путь</p>
    </div>
  </div>
</template>

<style scoped>
.path-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  padding: 0 var(--sp-3);
  color: var(--muted);
  font: var(--fs-xs) var(--mono);
}
.path-bar:focus-within {
  border-color: var(--focus);
}
.path-icon {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  color: var(--faint);
}
.segments {
  display: flex;
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.segment {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 100%;
}
button {
  font: inherit;
  color: inherit;
}
.segment-label {
  padding: var(--sp-1) var(--sp-2);
  white-space: nowrap;
  border-radius: var(--r-sm);
}
.segment:last-of-type .segment-label {
  color: var(--text);
}
.segment-arrow {
  display: grid;
  place-items: center;
  width: 22px;
  height: 26px;
  border-radius: var(--r-sm);
  color: var(--faint);
}
.segment-arrow svg {
  width: 12px;
  height: 12px;
}
.segment-arrow[aria-expanded="true"] svg {
  transform: rotate(90deg);
}
.segment-label:hover,
.segment-arrow:hover,
.segment-arrow[aria-expanded="true"] {
  background: var(--active);
  color: var(--text);
}
.edit-space {
  align-self: stretch;
  flex: 1;
  min-width: 24px;
}
.input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 26px;
  overflow: hidden;
}
.input-wrap input,
.completion {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  font: inherit;
  line-height: 26px;
  letter-spacing: normal;
  white-space: pre;
}
.input-wrap input {
  box-sizing: border-box;
  z-index: 1;
  color: var(--text);
  background: transparent;
  outline: none;
  box-shadow: none;
}
.completion {
  pointer-events: none;
  color: var(--faint);
  overflow: hidden;
}
.completion > span {
  display: inline-block;
}
.typed {
  visibility: hidden;
}
.key-hint {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--faint);
}
.dropdown {
  position: absolute;
  top: calc(100% + 5px);
  left: -1px;
  z-index: 30;
  width: min(640px, 100%);
  min-width: min(280px, 100%);
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-popover);
  padding: var(--sp-1);
}
.dropdown-heading {
  padding: var(--sp-2) var(--sp-2);
  font-size: var(--fs-2xs);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--line);
}
.options {
  max-height: min(320px, 45dvh);
  overflow-y: auto;
}
.options button {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2) var(--sp-2);
  text-align: left;
  border-radius: var(--r-sm);
}
.options button svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--faint);
}
.options button svg:last-child {
  margin-left: auto;
  width: 12px;
}
.options button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.options button:hover,
.options button.highlighted,
.options button:focus-visible {
  background: var(--active);
  color: var(--text);
}
.notice {
  margin: 0;
  padding: var(--sp-3) var(--sp-2);
  color: var(--faint);
}
.error {
  color: var(--err);
}
@media (max-width: 600px) {
  .key-hint {
    display: none;
  }
  .path-bar {
    padding: 0 var(--sp-2);
    gap: var(--sp-1);
  }
}
</style>
