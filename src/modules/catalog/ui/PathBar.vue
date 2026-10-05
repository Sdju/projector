<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconFolder from "~icons/lucide/folder";
import { fetchDirectories, parseProjectRef, projectRefSegments } from "../../project/index.ts";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import { GithubClone } from "../../integrations/index.ts";
import PathDropdown from "./PathDropdown.vue";
import { useDirectoryListing } from "../model/directory-listing.ts";
const props = defineProps<{ path: string; navigate: (path: string) => Promise<void> }>();
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const editing = ref(false);
const value = ref("");
const menuPath = ref<string | null>(null);
const busy = ref(false);
const scroll = ref(0);
const caretAtEnd = ref(true);
const listId = useId();
const { entries, selected, loading, error, truncated, invalidate, load, schedule } =
  useDirectoryListing();
let disposed = false;
const remoteInput = computed(() => parseProjectRef(value.value).kind !== "local");
const remoteProject = computed(() => parseProjectRef(props.path).kind !== "local");
const open = computed(() => editing.value || menuPath.value !== null);
const commands = useCommandScope(`path-bar:${listId}`, () => ({
  surface: "path-bar",
  path: props.path,
}));
commands.scope.registerCommand({
  id: "ide.project.path.suggestions",
  title: "Выбрать соседний проект",
  description:
    "Показывает папки локального пути или репозитории владельца GitHub. Повторный вызов закрывает список.",
  arguments: { path: "Путь сегмента, например gh:/owner" },
  enabled: () => !busy.value,
  run: (args) => {
    const { path } = commandArgs(args);
    if (typeof path !== "string") throw new Error("Укажите путь сегмента");
    return toggle(path);
  },
});
const githubOwnerPath = computed(() => {
  const project = parseProjectRef(props.path);
  return project.kind === "github" ? `gh:/${project.repository.split("/")[0]}` : "";
});
const listingRemote = computed(
  () => parseProjectRef(menuPath.value ?? value.value).kind === "github",
);
const segments = computed(() => projectRefSegments(parseProjectRef(props.path)));
const candidate = computed(() => entries.value[selected.value < 0 ? 0 : selected.value]);
const completion = computed(() => {
  if (!editing.value || !caretAtEnd.value || !candidate.value) return "";
  const name = candidate.value.name;
  const slash = Math.max(value.value.lastIndexOf("/"), value.value.lastIndexOf("\\"));
  const prefix = value.value.slice(slash + 1);
  const separator = value.value.includes("\\") ? "\\" : "/";
  if (value.value === "~") return "";
  const matches = remoteInput.value
    ? name.toLowerCase().startsWith(prefix.toLowerCase())
    : name.startsWith(prefix);
  return matches ? name.slice(prefix.length) + (remoteInput.value ? "" : separator) : "";
});
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
async function toggle(path: string) {
  if (busy.value) return;
  if (menuPath.value === path) {
    close();
    return;
  }
  editing.value = false;
  menuPath.value = path;
  const project = parseProjectRef(path);
  const listingPath =
    project.kind === "github"
      ? `gh:/${project.repository.split("/")[0] || githubOwnerPath.value.slice(4)}`
      : path;
  await load(listingPath, false);
}
function syncCaret() {
  scroll.value = input.value?.scrollLeft ?? 0;
  caretAtEnd.value =
    input.value?.selectionStart === value.value.length &&
    input.value?.selectionEnd === value.value.length;
}
function changed() {
  syncCaret();
  schedule(value.value);
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
        <GithubClone
          v-if="remoteProject && segment.path === path"
          :repository="path.slice(4)"
          :navigate="props.navigate"
        />
        <button
          v-else
          class="segment-arrow"
          :aria-label="
            remoteProject
              ? `Репозитории ${githubOwnerPath.slice(4)} (${segment.name})`
              : `Папки в ${segment.path}`
          "
          :aria-expanded="menuPath === segment.path"
          aria-haspopup="listbox"
          :aria-controls="listId"
          :disabled="busy"
          @click="commands.run('ide.project.path.suggestions', { path: segment.path })"
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
        :aria-label="remoteInput ? 'Репозиторий GitHub' : 'Путь к папке'"
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
    <PathDropdown
      v-if="open"
      :id="listId"
      :heading="
        editing
          ? remoteInput
            ? 'Открыть репозиторий'
            : 'Перейти в папку'
          : remoteProject
            ? `Репозитории ${githubOwnerPath.slice(4)}`
            : (menuPath ?? '')
      "
      :editing="editing"
      :remote="listingRemote"
      :entries="entries"
      :selected="selected"
      :loading="loading"
      :error="error"
      :truncated="truncated"
      :busy="busy"
      @pick="navigate"
    />
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
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .path-bar {
    height: 44px;
  }
  .input-wrap {
    height: 40px;
  }
  .input-wrap input,
  .completion {
    min-height: 0;
    line-height: 40px;
    font-size: var(--fs-input);
  }
  .segment-label,
  .segment-arrow {
    min-height: var(--control-h-sm);
  }
  .segment-arrow {
    width: 32px;
  }
  .key-hint {
    display: none;
  }
  .path-bar {
    padding: 0 var(--sp-2);
    gap: var(--sp-1);
  }
}
</style>
