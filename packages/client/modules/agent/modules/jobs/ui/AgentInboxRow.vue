<script setup lang="ts">
import { computed } from "vue";
import UiBadge from "../../../../../common/ui/UiBadge.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import { formatElapsed, useElapsedClock } from "../../../../agent-core/index.ts";
import type { InboxItem } from "../model/inbox.ts";
import AgentJobRequests from "./AgentJobRequests.vue";
import AgentRunRequests from "./AgentRunRequests.vue";

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
const tone = computed(() => {
  if (props.item.status === "error") return "danger";
  if (props.item.category === "attention") return "warning";
  if (props.item.category === "working" || props.unread) return "info";
  return "neutral";
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
    return `работает ${formatElapsed(now.value - props.item.startedAt)}`;
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
  <article class="item" :class="[item.category, { unread }]">
    <UiInline class="meta" :gap="1.5" wrap>
      <UiBadge :tone="tone">{{ statusLabel }}</UiBadge>
      <span class="agent">{{ item.agent }}</span>
      <span class="when">{{ when }}</span>
    </UiInline>
    <p class="topic" :title="item.topic">{{ item.topic || `Работа без темы (${what})` }}</p>
    <p v-if="requestNote" class="request-note">{{ requestNote }}</p>
    <p v-if="item.error && item.status === 'error'" class="failure">{{ item.error }}</p>
    <p
      v-else-if="item.resultPreview && (item.status === 'done' || item.awaitingReply)"
      class="preview"
      :title="item.resultPreview"
    >
      {{ item.resultPreview }}
    </p>
    <UiInline class="actions" :gap="1.5" wrap>
      <UiButton
        size="sm"
        :disabled="busy || !item.projectPath"
        :title="item.projectPath ? undefined : 'Проект не найден в каталоге этого устройства'"
        @click="emit('open')"
      >
        {{ item.kind === "job" ? "Открыть" : "К чату" }}
      </UiButton>
      <UiButton v-if="canStop" size="sm" tone="danger" :busy="busy" @click="emit('stop')">{{
        item.kind === "job" ? "Остановить" : "Прервать"
      }}</UiButton>
      <UiButton
        v-if="acknowledgeable"
        size="sm"
        title="Отметить уведомление прочитанным"
        @click="emit('read')"
      >
        Прочитано
      </UiButton>
      <span v-if="item.pending.length" class="waiting">
        {{ item.pending.length }} {{ item.pending.length === 1 ? "запрос" : "запроса" }}
      </span>
    </UiInline>
    <AgentJobRequests
      v-if="item.job && item.pending.length"
      class="requests"
      :jobs="[item.job]"
      :base="item.sourceBase || undefined"
      @answered="emit('answered')"
    />
    <AgentRunRequests
      v-else-if="item.kind === 'run' && item.pending.length"
      class="requests"
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
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
}
.item.attention {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
}
.item.unread {
  border-color: color-mix(in srgb, var(--info) 45%, var(--line));
}
.meta {
  min-width: 0;
}
.agent {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.when {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.topic {
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
  line-height: 1.4;
}
.request-note {
  margin: 0;
  color: var(--warn);
  font-size: var(--fs-2xs);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.preview {
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.failure {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-2xs);
  overflow-wrap: anywhere;
}
.actions {
  min-width: 0;
}
.waiting {
  color: var(--warn);
  font-size: var(--fs-2xs);
}
.requests {
  margin-top: var(--sp-1);
}
.requests :deep(.risk-box) {
  width: 44px;
  height: 44px;
}
.requests :deep(.risk-box svg) {
  width: 18px;
  height: 18px;
}
.requests :deep(.title-row) {
  padding-right: 0;
  flex-wrap: wrap;
}
.requests :deep(.tool) {
  position: static;
}
.requests :deep(.question.ui-card),
.requests :deep(.secret.ui-card) {
  font-size: var(--fs-xs);
}
</style>
