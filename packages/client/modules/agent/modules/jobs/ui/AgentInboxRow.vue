<script setup lang="ts">
import { computed } from "vue";
import UiBadge from "../../../../../common/ui/UiBadge.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import { formatElapsed, useElapsedClock } from "../../../../agent-core/index.ts";
import type { InboxItem } from "../model/inbox.ts";
import AgentJobRequests from "./AgentJobRequests.vue";

const props = defineProps<{ item: InboxItem; busy?: boolean }>();
const emit = defineEmits<{ open: []; stop: []; answered: [] }>();
const now = useElapsedClock();

const labels: Record<InboxItem["status"], string> = {
  queued: "в очереди",
  running: "работает",
  "needs-user": "ждёт вас",
  done: "готово",
  error: "ошибка",
  stopped: "остановлено",
};
const tone = computed(() => {
  if (props.item.status === "error") return "danger";
  if (props.item.category === "attention") return "warning";
  if (props.item.category === "working") return "info";
  return "neutral";
});
const canStop = computed(
  () =>
    props.item.kind === "run" ||
    props.item.status === "running" ||
    props.item.status === "queued" ||
    props.item.status === "needs-user",
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
</script>

<template>
  <article class="item" :class="item.category">
    <UiInline class="meta" :gap="1.5" wrap>
      <UiBadge :tone="tone">{{ labels[item.status] }}</UiBadge>
      <span class="agent">{{ item.agent }}</span>
      <span class="when">{{ when }}</span>
    </UiInline>
    <p class="topic" :title="item.topic">{{ item.topic || `Работа без темы (${what})` }}</p>
    <p v-if="item.error && item.status === 'error'" class="failure">{{ item.error }}</p>
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
</style>
