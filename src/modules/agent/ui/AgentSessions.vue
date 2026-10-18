<script setup lang="ts">
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import UiInline from "../../../common/ui/UiInline.vue";
import UiControl, { type UiControlHandle } from "../../../common/ui/UiControl.vue";
import { computed, nextTick, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentSessionInfo } from "../model/types.ts";
import IconHistory from "~icons/lucide/history";
import IconPin from "~icons/lucide/pin";
import IconPencil from "~icons/lucide/pencil";
import IconTrash from "~icons/lucide/trash-2";

const props = defineProps<{
  sessions: AgentSessionInfo[];
  loading: boolean;
  error: string;
  disabled: boolean;
  /** The native session this chat continues, marked in the list. */
  active?: string;
  /** The agent can rename and pin its sessions. */
  editable?: boolean;
  /** A session can be removed from the list for good. */
  deletable?: boolean;
  /** What the list is called: past sessions of an agent, or the chat history. */
  label?: string;
}>();
const emit = defineEmits<{
  open: [];
  pick: [id: string];
  change: [id: string, change: { title?: string; pinned?: boolean }];
  remove: [id: string];
}>();
const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ["input[type=search]", "button.item"],
  items: "button.item, button.mini",
});
const { open: shown } = menu;
const search = ref("");
const renaming = ref("");
const draft = ref("");
const confirming = ref("");
const searchInput = ref<UiControlHandle>();
const visible = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return needle
    ? props.sessions.filter((item) => item.title.toLocaleLowerCase().includes(needle))
    : props.sessions;
});
let renameRow: HTMLElement | undefined;
function startRename(session: AgentSessionInfo, event: MouseEvent) {
  renameRow = (event.currentTarget as HTMLElement).closest<HTMLElement>(".row") ?? undefined;
  renaming.value = session.id;
  draft.value = session.title;
  void nextTick(() =>
    menu.island.value?.querySelector<HTMLElement>('[aria-label="Название сессии"]')?.focus(),
  );
}
function finishRename(save: boolean, restoreFocus = false) {
  const row = renameRow;
  renameRow = undefined;
  const id = renaming.value;
  renaming.value = "";
  const title = draft.value.trim();
  if (save && id && title && title !== props.sessions.find((item) => item.id === id)?.title)
    emit("change", id, { title });
  if (restoreFocus)
    void nextTick(() => {
      if (!shown.value) return;
      const target = row?.isConnected
        ? row.querySelector<HTMLButtonElement>('.mini[aria-label="Переименовать сессию"]')
        : searchInput.value;
      target?.focus();
    });
}
/** A removal cannot be undone: the first click arms the button, the second one deletes. */
function remove(id: string) {
  if (confirming.value !== id) {
    confirming.value = id;
    return;
  }
  confirming.value = "";
  emit("remove", id);
}
function pick(id: string) {
  menu.close();
  emit("pick", id);
}
watch(shown, (open) => {
  if (open) {
    search.value = "";
    emit("open");
  } else {
    renaming.value = "";
    confirming.value = "";
    renameRow = undefined;
  }
});
// Sessions arrive asynchronously on first open. Give the list its initial focus when ready.
watch(
  () => props.loading,
  async (loading) => {
    if (loading || !shown.value) return;
    await nextTick();
    if (shown.value && !menu.island.value?.contains(document.activeElement))
      menu.island.value?.querySelector<HTMLElement>("input[type=search], button.item")?.focus();
  },
);

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
  <div :ref="menu.trigger" class="agent-sessions">
    <UiButton
      shape="icon"
      size="sm"
      :title="label ?? 'Прошлые сессии'"
      :aria-label="label ?? 'Прошлые сессии'"
      :aria-expanded="shown"
      :disabled="disabled"
      @click="menu.toggle()"
    >
      <IconHistory aria-hidden="true" />
    </UiButton>
    <UiIsland :menu="menu" :label="label ?? 'Прошлые сессии'" :width="320">
      <UiControl
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
      <p v-else-if="!sessions.length" class="note">
        {{ label ? "Прошлых чатов пока нет" : "В этой папке пока нет сессий" }}
      </p>
      <p v-else-if="!visible.length" class="note">Ничего не найдено</p>
      <UiInline
        v-for="session in visible"
        :key="session.id"
        class="row"
        :gap="0.5"
        justify="normal"
      >
        <UiControl
          v-if="renaming === session.id"
          v-model="draft"
          class="rename"
          aria-label="Название сессии"
          @keydown.enter.prevent="finishRename(true, true)"
          @keydown.esc.stop.prevent="finishRename(false, true)"
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
          <span class="title u-truncate">{{ session.title }}</span>
          <span class="age">{{ age(session.updatedAt) }}</span>
        </button>
        <UiInline
          as="span"
          v-if="(editable || deletable) && renaming !== session.id"
          class="row-actions"
          :gap="0.5"
          align="normal"
          justify="normal"
        >
          <button
            v-if="editable"
            type="button"
            class="mini"
            :title="session.pinned ? 'Открепить' : 'Закрепить сверху'"
            :aria-label="session.pinned ? 'Открепить сессию' : 'Закрепить сессию'"
            @click="emit('change', session.id, { pinned: !session.pinned })"
          >
            <IconPin aria-hidden="true" />
          </button>
          <button
            v-if="editable"
            type="button"
            class="mini"
            title="Переименовать"
            aria-label="Переименовать сессию"
            @click="startRename(session, $event)"
          >
            <IconPencil aria-hidden="true" />
          </button>
          <button
            v-if="deletable"
            type="button"
            class="mini"
            :class="{ danger: confirming === session.id }"
            :title="
              confirming === session.id ? 'Нажмите ещё раз, чтобы удалить навсегда' : 'Удалить'
            "
            :aria-label="confirming === session.id ? 'Подтвердить удаление' : 'Удалить сессию'"
            @click="remove(session.id)"
            @blur="confirming = ''"
          >
            <IconTrash aria-hidden="true" />
          </button>
        </UiInline>
      </UiInline>
    </UiIsland>
  </div>
</template>

<style scoped>
.agent-sessions {
  position: relative;
}
.note {
  margin: 0;
  padding: 10px 12px;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.note.error {
  color: var(--warn);
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
.row .item {
  flex: 1;
  min-width: 0;
}
.row-actions {
  display: none;
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
.mini.danger {
  background: var(--bg-4);
  color: var(--err);
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
}
.age {
  flex-shrink: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
