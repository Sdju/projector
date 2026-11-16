<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { formatElapsed, useElapsedClock } from "../../../../agent-core/index.ts";
import type { InboxItem } from "../model/inbox.ts";
import AgentJobRequests from "./AgentJobRequests.vue";
import AgentRunRequests from "./AgentRunRequests.vue";
import IconCheck from "~icons/lucide/check";
import IconSquare from "~icons/lucide/square";

const props = defineProps<{
  item: InboxItem;
  busy?: boolean;
  unread?: boolean;
  acknowledgeable?: boolean;
}>();
const emit = defineEmits<{ open: []; stop: []; answered: []; read: [] }>();
const now = useElapsedClock();

const labels: Record<InboxItem["status"], string> = {
  queued: "в очереди",
  running: "работает",
  "needs-user": "ждёт вас",
  done: "готово",
  error: "ошибка",
  stopped: "остановлено",
};
const statusLabel = computed(() =>
  props.item.awaitingReply ? "ждёт ответа" : labels[props.item.status],
);
const tone = computed<"danger" | "warning" | "success" | "faint">(() => {
  if (props.item.status === "error") return "danger";
  if (props.item.category === "attention") return "warning";
  if (props.item.category === "working" || props.unread) return "success";
  return "faint";
});
const canStop = computed(
  () =>
    props.item.status === "running" ||
    props.item.status === "queued" ||
    (props.item.status === "needs-user" && !props.item.awaitingReply),
);
const what = computed(() => (props.item.kind === "job" ? "задание" : "чат"));
const when = computed(() => {
  if (props.item.category === "working" && props.item.startedAt !== undefined)
    return formatElapsed(now.value - props.item.startedAt);
  const at = props.item.endedAt ?? props.item.startedAt ?? props.item.createdAt;
  return new Date(at).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
});

const requestNote = computed(() => {
  if (props.item.awaitingReply && !props.item.pending.length)
    return "Агент отправил форму и ждёт вашего ответа";
  const card = props.item.pending[0];
  if (!card) return "";
  if (card.kind === "permission" && card.judge)
    return `Судья ${card.judge.score}/5 (${card.judge.label}) · ${card.judge.reason}`;
  if (card.kind === "question") return "Агент задаёт вопрос и ждёт ответа";
  if (card.kind === "secret") return `Агент запрашивает секрет: ${card.title}`;
  return `Агент ждёт разрешения: ${card.title}`;
});
</script>

<template>
  <article class="item" :class="{ read: tone === 'faint' }">
    <button
      type="button"
      class="main"
      :disabled="busy || !item.projectPath"
      :title="item.projectPath ? undefined : 'Проект не найден в каталоге этого устройства'"
      @click="emit('open')"
    >
      <span class="head">
        <UiStatusDot :tone="tone" />
        <span class="topic" :title="item.topic">{{
          item.topic || `Работа без темы (${what})`
        }}</span>
      </span>
      <span class="meta">{{ item.agent }} · {{ statusLabel }} · {{ when }}</span>
      <span v-if="requestNote" class="note warn">{{ requestNote }}</span>
      <span v-if="item.error && item.status === 'error'" class="note err">{{ item.error }}</span>
      <span
        v-else-if="item.resultPreview && (item.status === 'done' || item.awaitingReply)"
        class="preview"
        :title="item.resultPreview"
      >
        {{ item.resultPreview }}
      </span>
      <span v-if="item.pending.length" class="note warn">
        {{ item.pending.length }} {{ item.pending.length === 1 ? "запрос" : "запроса" }}
      </span>
    </button>
    <div v-if="canStop || acknowledgeable" class="actions">
      <UiButton
        v-if="canStop"
        shape="icon"
        size="sm"
        tone="danger"
        :title="item.kind === 'job' ? 'Остановить задание' : 'Прервать ответ'"
        :aria-label="item.kind === 'job' ? 'Остановить задание' : 'Прервать ответ'"
        :busy="busy"
        @click="emit('stop')"
      >
        <IconSquare aria-hidden="true" />
      </UiButton>
      <UiButton
        v-if="acknowledgeable"
        shape="icon"
        size="sm"
        title="Отметить прочитанным"
        aria-label="Отметить прочитанным"
        @click="emit('read')"
      >
        <IconCheck aria-hidden="true" />
      </UiButton>
    </div>
    <AgentJobRequests
      v-if="item.job && item.pending.length"
      class="requests"
      compact
      :jobs="[item.job]"
      :base="item.sourceBase || undefined"
      @answered="emit('answered')"
    />
    <AgentRunRequests
      v-else-if="item.kind === 'run' && item.pending.length"
      class="requests"
      compact
      :pending="item.pending"
      :agent="item.agent"
      :base="item.sourceBase || undefined"
      @answered="emit('answered')"
    />
  </article>
</template>

<style scoped>
.item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  min-width: 0;
  border-top: 1px solid var(--line);
}
.item:hover {
  background: var(--hover);
}
.main {
  --indent: calc(7px + var(--sp-2));
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--text-2);
  text-align: left;
}
.main:disabled {
  cursor: default;
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  min-width: 0;
}
.head :deep(.ui-status-dot) {
  align-self: center;
}
.topic {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 500;
  line-height: 1.35;
}
.item.read .topic {
  color: var(--text-2);
  font-weight: 400;
}
.meta {
  padding-left: var(--indent);
  overflow: hidden;
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.preview,
.note {
  padding-left: var(--indent);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.note.warn {
  color: var(--warn);
  -webkit-line-clamp: unset;
}
.note.err {
  color: var(--err);
  -webkit-line-clamp: 4;
}
.actions {
  display: flex;
  gap: 2px;
  padding: var(--sp-1) var(--sp-2) 0 0;
}
.requests {
  grid-column: 1 / -1;
  margin: 0 var(--sp-3) var(--sp-3);
}
.requests :deep(.secret.ui-card) {
  font-size: var(--fs-xs);
}
</style>
