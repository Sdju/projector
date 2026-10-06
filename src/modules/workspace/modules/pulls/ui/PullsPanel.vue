<script setup lang="ts">
import { ref, watch } from "vue";
import type { IssueLabel, PullRequest } from "../../../../../../core/modules/workspace/index.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconOpen from "~icons/lucide/git-pull-request";
import IconDraft from "~icons/lucide/git-pull-request-draft";
import IconClosed from "~icons/lucide/git-pull-request-closed";
import IconMerged from "~icons/lucide/git-merge";
import { usePulls, type PullState } from "../lib/pulls.ts";

/** Сайдбар-блок pull requests: состояние, список и подгрузка следующих страниц. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [pull: { number: number; title: string }, pinned?: boolean];
}>();
const { state, pulls, next, loading, loadingMore, error, load, more, filter, reset } = usePulls(
  () => props.projectId,
);
const open = ref(true);
const states: Array<{ value: PullState; label: string }> = [
  { value: "open", label: "открытые" },
  { value: "closed", label: "закрытые" },
  { value: "all", label: "все" },
];
const commands = useCommandScope(`pulls:${props.projectId}`, () => ({
  surface: "pulls",
  projectId: props.projectId,
}));
const register = useCommandRegistrar(commands.scope);
register(
  "ide.pulls.block.toggle",
  "Свернуть или развернуть блок pull requests",
  "Показывает или скрывает список pull requests в сайдбаре.",
  () => {
    open.value = !open.value;
  },
);
register(
  "ide.pulls.refresh",
  "Обновить список pull requests",
  "Перечитывает первую страницу pull requests GitHub с текущим фильтром состояния.",
  () => load(),
);
register(
  "ide.pulls.filter",
  "Отфильтровать pull requests по состоянию",
  "Переключает state и перечитывает список.",
  (value) => {
    const { state: next } = commandArgs(value);
    if (next !== "open" && next !== "closed" && next !== "all")
      throw new Error("Укажите state: open, closed или all");
    return filter(next);
  },
  { state: "string: open, closed или all" },
);
register(
  "ide.pulls.more",
  "Показать следующую страницу pull requests",
  "Догружает следующую страницу pull requests текущего фильтра (по 30).",
  () => more(),
);
register(
  "ide.pulls.open",
  "Открыть pull request",
  "Открывает вкладку выбранного pull request: описание, ревью, обсуждение и изменённые файлы.",
  (value) => {
    const { number, title, pinned } = commandArgs(value);
    if (typeof number !== "number") throw new Error("Укажите номер pull request");
    emit("open", { number, title: typeof title === "string" ? title : "" }, pinned === true);
  },
  {
    number: "number: номер pull request",
    title: "string (необязательно): заголовок вкладки",
    pinned: "boolean (необязательно): true — постоянная вкладка вместо временной",
  },
);
let loaded = false;
watch(
  () => props.active,
  (active) => {
    if (!active || loaded) return;
    loaded = true;
    void load();
  },
  { immediate: true },
);
// Смена проекта пересоздаёт панель; защита от устаревших запросов внутри usePulls.
watch(
  () => props.projectId,
  () => {
    loaded = false;
    reset();
  },
);
const stateIcon = (pull: PullRequest) =>
  pull.state === "merged"
    ? IconMerged
    : pull.state === "closed"
      ? IconClosed
      : pull.draft
        ? IconDraft
        : IconOpen;
const stateClass = (pull: PullRequest) =>
  pull.draft && pull.state === "open" ? "draft" : pull.state;
function labelDot(label: IssueLabel) {
  return label.color ? `#${label.color}` : "transparent";
}
defineExpose({ refresh: () => load() });
</script>

<template>
  <div class="side-content pulls-panel">
    <button
      class="block-toggle"
      type="button"
      :aria-expanded="open"
      data-command="ide.pulls.block.toggle"
      @click="commands.run('ide.pulls.block.toggle')"
    >
      <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
      <h3>
        Pull requests <span v-if="pulls.length" class="count">{{ pulls.length }}</span>
      </h3>
    </button>
    <div v-show="open" class="block-body">
      <div class="state-filter" role="group" aria-label="Состояние pull requests">
        <button
          v-for="option in states"
          :key="option.value"
          type="button"
          :class="{ active: state === option.value }"
          :aria-pressed="state === option.value"
          @click="commands.run('ide.pulls.filter', { state: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
      <p v-if="loading" class="note" role="status">загрузка pull requests…</p>
      <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="!pulls.length" class="note">Нет pull requests</p>
      <ul v-else class="pull-list">
        <li v-for="pull in pulls" :key="pull.number">
          <button
            type="button"
            class="pull-row"
            @click="commands.run('ide.pulls.open', { number: pull.number, title: pull.title })"
            @dblclick="
              commands.run('ide.pulls.open', {
                number: pull.number,
                title: pull.title,
                pinned: true,
              })
            "
          >
            <span class="pull-title">
              <component
                :is="stateIcon(pull)"
                class="state"
                :class="stateClass(pull)"
                aria-hidden="true"
              />
              {{ pull.title }}
            </span>
            <span class="pull-meta">
              <span class="number">#{{ pull.number }}</span>
              <span v-for="label in pull.labels.slice(0, 3)" :key="label.name" class="label">
                <span class="dot" :style="{ background: labelDot(label) }" />
                {{ label.name }}
              </span>
              <span class="author">
                <UiAvatar :src="pull.author.avatarUrl" :alt="pull.author.login" :size="14" />
                {{ pull.author.login }}
              </span>
              <span class="branches" :title="`${pull.head} → ${pull.base}`">
                {{ pull.head }} → {{ pull.base }}
              </span>
            </span>
          </button>
        </li>
      </ul>
      <button
        v-if="next !== null && !loading"
        type="button"
        class="more"
        :disabled="loadingMore"
        @click="commands.run('ide.pulls.more')"
      >
        {{ loadingMore ? "загрузка…" : "Показать ещё" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pulls-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.block-toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.block-toggle:hover {
  color: var(--text);
}
.chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform var(--t-fast);
}
.chevron.open {
  transform: rotate(90deg);
}
h3 {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: 500;
  color: inherit;
}
.count {
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.block-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.state-filter {
  display: flex;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
}
.state-filter button {
  flex: 1;
  padding: 2px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state-filter button:hover {
  color: var(--text);
}
.state-filter button.active {
  border-color: var(--focus);
  color: var(--text);
  background: var(--active);
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.note.error {
  color: var(--err);
}
.pull-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.pull-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
  border-top: 1px solid var(--line);
}
.pull-row:hover {
  background: var(--active);
  color: var(--text);
}
.pull-title {
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.pull-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.number,
.author {
  font-family: var(--mono);
}
.author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
}
.pull-title {
  display: flex;
  gap: var(--sp-1);
}
.state {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 1px;
  color: var(--muted);
}
.state.open {
  color: var(--run);
}
.state.merged {
  color: var(--accent);
}
.branches {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
}
.more {
  margin: var(--sp-2) var(--sp-3);
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.more:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line-strong);
}
.more:disabled {
  opacity: 0.6;
}
</style>
