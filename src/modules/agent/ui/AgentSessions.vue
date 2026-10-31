<script setup lang="ts">
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import UiInline from "../../../common/ui/UiInline.vue";
import UiControl, { type UiControlHandle } from "../../../common/ui/UiControl.vue";
import { computed, nextTick, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentRecentChat, AgentSessionInfo } from "../model/types.ts";
import IconHistory from "~icons/lucide/history";
import IconBranch from "~icons/lucide/git-branch";
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
  /** Chats of the project kept on disk, including closed tabs. */
  recent?: AgentRecentChat[];
  recentLoading?: boolean;
  recentError?: string;
}>();
const emit = defineEmits<{
  open: [];
  pick: [id: string];
  change: [id: string, change: { title?: string; pinned?: boolean }];
  remove: [id: string];
  openRecent: [chat: string, title: string];
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
/**
 * One entry of the history: a native session of the agent, a chat tab of the project, or both of
 * them when the chat continues that session. The menu never shows the two as different things.
 */
interface HistoryEntry extends AgentSessionInfo {
  /** The tab to open or focus, when the conversation has one. */
  chat?: string;
  /** A native session or archived chat is behind the row, so rename/pin/delete apply to it. */
  native?: boolean;
}
const history = computed<HistoryEntry[]>(() => {
  const entries = props.sessions.map((session): HistoryEntry => ({ ...session, native: true }));
  const bySession = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const chat of props.recent ?? []) {
    if (chat.session) {
      const known = bySession.get(chat.session);
      // The same conversation: keep one row, openable as its tab.
      if (known) {
        // Two tabs continued one session: the newest one stands for both.
        if (known.chat) continue;
        known.chat = chat.chat;
        if (chat.updatedAt > (known.updatedAt ?? "")) known.updatedAt = chat.updatedAt;
        continue;
      }
      // Two tabs continued one session: the newest one stands for both.
      if (seen.has(chat.session)) continue;
      seen.add(chat.session);
    }
    entries.push({
      id: chat.chat,
      title: chat.title,
      updatedAt: chat.updatedAt,
      chat: chat.chat,
      native: false,
    });
  }
  return entries.sort(
    (a, b) =>
      Number(b.pinned === true) - Number(a.pinned === true) ||
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
});
/** Branches of subagents clutter history, so they are folded under their chats until asked for. */
const showBranches = ref(false);
const branchCount = computed(() => history.value.filter((item) => item.parent).length);
const searchActive = computed(() => search.value.trim().length > 0);
const branchesShown = computed(() => showBranches.value || searchActive.value);
const visible = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return needle
    ? history.value.filter((item) => item.title.toLocaleLowerCase().includes(needle))
    : history.value;
});
/** Rows in display order: a branch follows the chat it was started from, indented by its depth. */
const rows = computed<{ session: HistoryEntry; depth: number }[]>(() => {
  const mains = visible.value.filter((item) => !item.parent);
  if (!branchesShown.value) return mains.map((session) => ({ session, depth: 0 }));
  const children = new Map<string, HistoryEntry[]>();
  for (const session of visible.value) {
    if (!session.parent) continue;
    children.set(session.parent, [...(children.get(session.parent) ?? []), session]);
  }
  const result: { session: HistoryEntry; depth: number }[] = [];
  const seen = new Set<string>();
  const append = (session: HistoryEntry, depth: number) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    result.push({ session, depth });
    for (const child of children.get(session.id) ?? []) append(child, depth + 1);
  };
  for (const session of mains) append(session, 0);
  // A branch whose chat the search left out (or an older chat) still shows, marked as a branch.
  for (const session of visible.value) if (session.parent) append(session, 1);
  return result;
});
function titleOf(session: AgentSessionInfo): string {
  if (!session.parent) return session.title;
  return `${session.title} · ветка субагента${session.agent ? ` (${session.agent})` : ""}`;
}
let renameRow: HTMLElement | undefined;
function startRename(session: AgentSessionInfo, event: MouseEvent) {
  renameRow = (event.currentTarget as HTMLElement).closest<HTMLElement>(".row") ?? undefined;
  renaming.value = session.id;
  draft.value = session.title;
  void nextTick(() =>
    menu.island.value?.querySelector<HTMLElement>('[aria-label="Название чата"]')?.focus(),
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
        ? row.querySelector<HTMLButtonElement>('.mini[aria-label="Переименовать чат"]')
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
  // The row disappears with the focused button: the list keeps the keyboard reachable.
  void nextTick(() => {
    if (!shown.value || menu.island.value?.contains(document.activeElement)) return;
    menu.island.value?.querySelector<HTMLElement>("input[type=search], button.item")?.focus();
  });
}
function pick(entry: HistoryEntry) {
  menu.close();
  // A conversation that already has a tab is opened there; one known only by its session goes on
  // in this chat. The menu does not ask the user to tell these apart.
  if (entry.chat) emit("openRecent", entry.chat, entry.title);
  else emit("pick", entry.id);
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
      title="История"
      aria-label="История"
      :aria-expanded="shown"
      :disabled="disabled"
      @click="menu.toggle()"
    >
      <IconHistory aria-hidden="true" />
    </UiButton>
    <UiIsland :menu="menu" label="История" :width="320">
      <UiControl
        v-if="history.length > 4"
        ref="searchInput"
        v-model="search"
        class="search"
        type="search"
        placeholder="Найти чат"
        aria-label="Найти чат"
      />
      <p v-if="loading && !history.length" class="note">Загружаю…</p>
      <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="!history.length && !recentLoading" class="note">В истории пока пусто</p>
      <p v-else-if="!visible.length && !recentLoading" class="note">Ничего не найдено</p>
      <p v-else-if="!rows.length && !recentLoading && branchCount && !branchesShown" class="note">
        Основных чатов нет — только ветки субагентов
      </p>
      <UiInline v-for="row in rows" :key="row.session.id" class="row" :gap="0.5" justify="normal">
        <UiControl
          v-if="renaming === row.session.id"
          v-model="draft"
          class="rename"
          aria-label="Название чата"
          @keydown.enter.prevent="finishRename(true, true)"
          @keydown.esc.stop.prevent="finishRename(false, true)"
          @blur="finishRename(true)"
        />
        <button
          v-else
          type="button"
          role="menuitem"
          class="item"
          :class="{ active: row.session.id === active, branch: row.depth > 0 }"
          :style="row.depth ? { paddingLeft: `${10 + row.depth * 14}px` } : undefined"
          :title="titleOf(row.session)"
          @click="pick(row.session)"
        >
          <IconBranch v-if="row.session.parent" class="branch-mark" aria-hidden="true" />
          <IconPin v-if="row.session.pinned" class="pinned" aria-hidden="true" />
          <span class="title u-truncate">{{ row.session.title }}</span>
          <span v-if="row.session.agent" class="branch-agent">{{ row.session.agent }}</span>
          <span class="age">{{ age(row.session.updatedAt) }}</span>
        </button>
        <UiInline
          as="span"
          v-if="(editable || deletable) && row.session.native && renaming !== row.session.id"
          class="row-actions"
          :gap="0.5"
          align="normal"
          justify="normal"
        >
          <button
            v-if="editable"
            type="button"
            class="mini"
            :title="row.session.pinned ? 'Открепить' : 'Закрепить сверху'"
            :aria-label="row.session.pinned ? 'Открепить чат' : 'Закрепить чат'"
            @click="emit('change', row.session.id, { pinned: !row.session.pinned })"
          >
            <IconPin aria-hidden="true" />
          </button>
          <button
            v-if="editable"
            type="button"
            class="mini"
            title="Переименовать"
            aria-label="Переименовать чат"
            @click="startRename(row.session, $event)"
          >
            <IconPencil aria-hidden="true" />
          </button>
          <button
            v-if="deletable"
            type="button"
            class="mini"
            :class="{ danger: confirming === row.session.id }"
            :title="
              confirming === row.session.id ? 'Нажмите ещё раз, чтобы удалить навсегда' : 'Удалить'
            "
            :aria-label="confirming === row.session.id ? 'Подтвердить удаление' : 'Удалить чат'"
            @click="remove(row.session.id)"
            @blur="confirming = ''"
          >
            <IconTrash aria-hidden="true" />
          </button>
        </UiInline>
      </UiInline>
      <button
        v-if="branchCount"
        type="button"
        class="toggle"
        :aria-expanded="branchesShown"
        :disabled="searchActive"
        :title="
          searchActive
            ? 'Ветки субагентов видны при поиске'
            : branchesShown
              ? 'Свернуть ветки субагентов'
              : 'Развернуть ветки субагентов'
        "
        @click="showBranches = !showBranches"
      >
        <IconBranch aria-hidden="true" />
        <span v-if="searchActive">Ветки субагентов · {{ branchCount }}</span>
        <span v-else-if="branchesShown">Скрыть ветки субагентов</span>
        <span v-else>Показать ветки субагентов · {{ branchCount }}</span>
      </button>
      <p v-if="recentLoading && !history.length && !loading" class="note">Загружаю историю…</p>
      <p v-else-if="recentError" class="note error" role="alert">{{ recentError }}</p>
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
.pinned,
.branch-mark {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.pinned {
  color: var(--muted);
  align-self: center;
}
.branch-mark {
  color: var(--faint);
  align-self: center;
}
.item.branch {
  color: var(--muted);
}
.branch-agent {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--bg-4);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: var(--fs-2xs);
  text-align: left;
  cursor: pointer;
}
.toggle:hover:not(:disabled) {
  background: var(--bg-4);
  color: var(--text);
}
.toggle:disabled {
  cursor: default;
}
.toggle svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
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
