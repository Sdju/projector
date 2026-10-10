<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentSessionInfo } from "../model/types.ts";
import IconHistory from "~icons/lucide/history";
import IconPin from "~icons/lucide/pin";
import IconPencil from "~icons/lucide/pencil";

const props = defineProps<{
  sessions: AgentSessionInfo[];
  loading: boolean;
  error: string;
  disabled: boolean;
  /** The native session this chat continues, marked in the list. */
  active?: string;
  /** The agent can rename and pin its sessions. */
  editable?: boolean;
}>();
const emit = defineEmits<{
  open: [];
  pick: [id: string];
  change: [id: string, change: { title?: string; pinned?: boolean }];
}>();
const shown = ref(false);
const search = ref("");
const renaming = ref("");
const draft = ref("");
const searchInput = ref<HTMLInputElement>();
const visible = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return needle
    ? props.sessions.filter((item) => item.title.toLocaleLowerCase().includes(needle))
    : props.sessions;
});
function startRename(session: AgentSessionInfo) {
  renaming.value = session.id;
  draft.value = session.title;
}
function finishRename(save: boolean) {
  const id = renaming.value;
  renaming.value = "";
  const title = draft.value.trim();
  if (save && id && title && title !== props.sessions.find((item) => item.id === id)?.title)
    emit("change", id, { title });
}
const root = ref<HTMLElement>();

function toggle() {
  shown.value = !shown.value;
  if (shown.value) {
    emit("open");
    search.value = "";
    void nextTick(() => searchInput.value?.focus());
  }
}
function pick(id: string) {
  shown.value = false;
  emit("pick", id);
}
function outside(event: Event) {
  if (shown.value && !root.value?.contains(event.target as Node)) shown.value = false;
}
function escape(event: KeyboardEvent) {
  if (shown.value && event.key === "Escape") shown.value = false;
}
watch(shown, (open) => {
  if (open) {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
  } else {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escape, true);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", escape, true);
});

const relative = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
function age(value?: string): string {
  const time = value ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return "";
  const minutes = Math.round((time - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}
</script>

<template>
  <div ref="root" class="agent-sessions">
    <UiButton
      icon
      size="sm"
      title="Прошлые сессии"
      aria-label="Прошлые сессии"
      :aria-expanded="shown"
      :disabled="disabled"
      @click="toggle"
    >
      <IconHistory aria-hidden="true" />
    </UiButton>
    <div v-if="shown" class="panel" role="menu" aria-label="Прошлые сессии">
      <input
        v-if="sessions.length > 4"
        ref="searchInput"
        v-model="search"
        class="search"
        type="search"
        placeholder="Найти сессию"
        aria-label="Найти сессию"
      />
      <p v-if="loading" class="note">Загружаю…</p>
      <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="!sessions.length" class="note">В этой папке пока нет сессий</p>
      <p v-else-if="!visible.length" class="note">Ничего не найдено</p>
      <div v-for="session in visible" :key="session.id" class="row">
        <input
          v-if="renaming === session.id"
          v-model="draft"
          class="rename"
          aria-label="Название сессии"
          autofocus
          @keydown.enter.prevent="finishRename(true)"
          @keydown.esc.stop.prevent="finishRename(false)"
          @blur="finishRename(true)"
        />
        <button
          v-else
          type="button"
          role="menuitem"
          class="item"
          :class="{ active: session.id === active }"
          :title="session.title"
          @click="pick(session.id)"
        >
          <IconPin v-if="session.pinned" class="pinned" aria-hidden="true" />
          <span class="title">{{ session.title }}</span>
          <span class="age">{{ age(session.updatedAt) }}</span>
        </button>
        <span v-if="editable && renaming !== session.id" class="row-actions">
          <button
            type="button"
            class="mini"
            :title="session.pinned ? 'Открепить' : 'Закрепить сверху'"
            :aria-label="session.pinned ? 'Открепить сессию' : 'Закрепить сессию'"
            @click="emit('change', session.id, { pinned: !session.pinned })"
          >
            <IconPin aria-hidden="true" />
          </button>
          <button
            type="button"
            class="mini"
            title="Переименовать"
            aria-label="Переименовать сессию"
            @click="startRename(session)"
          >
            <IconPencil aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-sessions {
  position: relative;
}
.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: 80vw;
  max-height: 340px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  box-shadow: var(--shadow-popover);
  scrollbar-width: thin;
}
.note {
  margin: 0;
  padding: 10px 12px;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.note.error {
  color: var(--danger, var(--warn));
}
.item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-md, 6px);
  background: none;
  color: var(--text-2);
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}
.item:hover,
.item:focus-visible {
  background: var(--bg-4);
  color: var(--text);
}
.item.active {
  color: var(--text);
  font-weight: 600;
}
.search,
.rename {
  margin: 2px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md, 6px);
  background: var(--bg);
  color: var(--text);
  font-size: var(--fs-xs);
}
.rename {
  flex: 1;
}
.row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.row .item {
  flex: 1;
  min-width: 0;
}
.row-actions {
  display: none;
  gap: 2px;
}
.row:hover .row-actions,
.row:focus-within .row-actions {
  display: flex;
}
.mini {
  display: flex;
  padding: 4px;
  border-radius: var(--r-md, 6px);
  color: var(--muted);
}
.mini:hover {
  background: var(--bg-4);
  color: var(--text);
}
.mini svg,
.pinned {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.pinned {
  color: var(--muted);
  align-self: center;
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.age {
  flex-shrink: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
