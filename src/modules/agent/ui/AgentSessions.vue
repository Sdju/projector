<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentSessionInfo } from "../model/types.ts";
import IconHistory from "~icons/lucide/history";

defineProps<{
  sessions: AgentSessionInfo[];
  loading: boolean;
  error: string;
  disabled: boolean;
  /** The native session this chat continues, marked in the list. */
  active?: string;
}>();
const emit = defineEmits<{ open: []; pick: [id: string] }>();
const shown = ref(false);
const root = ref<HTMLElement>();

function toggle() {
  shown.value = !shown.value;
  if (shown.value) emit("open");
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
      <p v-if="loading" class="note">Загружаю…</p>
      <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="!sessions.length" class="note">В этой папке пока нет сессий</p>
      <button
        v-for="session in sessions"
        :key="session.id"
        type="button"
        role="menuitem"
        class="item"
        :class="{ active: session.id === active }"
        :title="session.title"
        @click="pick(session.id)"
      >
        <span class="title">{{ session.title }}</span>
        <span class="age">{{ age(session.updatedAt) }}</span>
      </button>
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
