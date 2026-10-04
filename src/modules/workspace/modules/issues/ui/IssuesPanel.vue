<script setup lang="ts">
import { ref, watch } from "vue";
import type { IssueLabel } from "../../../../../../core/modules/workspace/index.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconComment from "~icons/lucide/message-square";
import { useIssues, type IssueState } from "../lib/issues.ts";

/** Сайдбар-блок issues: состояние, список и подгрузка следующих страниц. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [issue: { number: number; title: string }, pinned?: boolean];
}>();
const { state, issues, next, loading, loadingMore, error, load, more, filter, reset } = useIssues(
  () => props.projectId,
);
const open = ref(true);
const states: Array<{ value: IssueState; label: string }> = [
  { value: "open", label: "открытые" },
  { value: "closed", label: "закрытые" },
  { value: "all", label: "все" },
];
const commands = useCommandScope(`issues:${props.projectId}`, () => ({
  surface: "issues",
  projectId: props.projectId,
}));
const register = useCommandRegistrar(commands.scope);
register(
  "ide.issues.block.toggle",
  "Свернуть или развернуть блок issues",
  "Показывает или скрывает список issues в сайдбаре.",
  () => {
    open.value = !open.value;
  },
);
register(
  "ide.issues.refresh",
  "Обновить список issues",
  "Перечитывает первую страницу issues GitHub с текущим фильтром состояния.",
  () => load(),
);
register(
  "ide.issues.filter",
  "Отфильтровать issues по состоянию",
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
  "ide.issues.more",
  "Показать следующую страницу issues",
  "Догружает следующую страницу issues текущего фильтра (до 30 без учёта pull requests).",
  () => more(),
);
register(
  "ide.issues.open",
  "Открыть issue",
  "Открывает вкладку обсуждения выбранного issue.",
  (value) => {
    const { number, title, pinned } = commandArgs(value);
    if (typeof number !== "number") throw new Error("Укажите номер issue");
    emit("open", { number, title: typeof title === "string" ? title : "" }, pinned === true);
  },
  {
    number: "number: номер issue",
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
// Смена проекта пересоздаёт панель; защита от устаревших запросов внутри useIssues.
watch(
  () => props.projectId,
  () => {
    loaded = false;
    reset();
  },
);
function labelDot(label: IssueLabel) {
  return label.color ? `#${label.color}` : "transparent";
}
defineExpose({ refresh: () => load() });
</script>

<template>
  <div class="side-content issues-panel">
    <button
      class="block-toggle"
      type="button"
      :aria-expanded="open"
      data-command="ide.issues.block.toggle"
      @click="commands.run('ide.issues.block.toggle')"
    >
      <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
      <h3>
        Issues <span v-if="issues.length" class="count">{{ issues.length }}</span>
      </h3>
    </button>
    <div v-show="open" class="block-body">
      <div class="state-filter" role="group" aria-label="Состояние issues">
        <button
          v-for="option in states"
          :key="option.value"
          type="button"
          :class="{ active: state === option.value }"
          :aria-pressed="state === option.value"
          @click="commands.run('ide.issues.filter', { state: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
      <p v-if="loading" class="note" role="status">загрузка issues…</p>
      <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="!issues.length" class="note">Нет issues</p>
      <ul v-else class="issue-list">
        <li v-for="issue in issues" :key="issue.number">
          <button
            type="button"
            class="issue-row"
            @click="commands.run('ide.issues.open', { number: issue.number, title: issue.title })"
            @dblclick="
              commands.run('ide.issues.open', {
                number: issue.number,
                title: issue.title,
                pinned: true,
              })
            "
          >
            <span class="issue-title">{{ issue.title }}</span>
            <span class="issue-meta">
              <span class="number">#{{ issue.number }}</span>
              <span v-for="label in issue.labels.slice(0, 3)" :key="label.name" class="label">
                <span class="dot" :style="{ background: labelDot(label) }" />
                {{ label.name }}
              </span>
              <span class="author">
                <UiAvatar :src="issue.author.avatarUrl" :alt="issue.author.login" :size="14" />
                {{ issue.author.login }}
              </span>
              <span
                v-if="issue.comments"
                class="comments"
                :title="`${issue.comments} комментариев`"
              >
                <IconComment aria-hidden="true" />{{ issue.comments }}
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
        @click="commands.run('ide.issues.more')"
      >
        {{ loadingMore ? "загрузка…" : "Показать ещё" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.issues-panel {
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
.issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.issue-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
  border-top: 1px solid var(--line);
}
.issue-row:hover {
  background: var(--active);
  color: var(--text);
}
.issue-title {
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.issue-meta {
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
.comments {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.comments svg {
  width: 12px;
  height: 12px;
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
