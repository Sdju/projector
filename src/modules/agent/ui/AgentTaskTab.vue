<script setup lang="ts">
import { computed } from "vue";
import { useTabReadout } from "../../../common/utilities/tab-readout.ts";
import { taskDetail, taskReadout } from "../lib/task-detail.ts";
import { chatsOf } from "../model/chat-registry.ts";
import AgentTaskView from "./AgentTaskView.vue";

/** A task of a chat followed in its own tab; the chat stays the source, so it updates live. */
const props = defineProps<{ projectId: string; chat: string; task: string }>();

const owner = computed(() => chatsOf(props.projectId).find((item) => item.key === props.chat));
const detail = computed(() =>
  owner.value ? taskDetail(owner.value.turns(), props.task) : undefined,
);
useTabReadout(() => ({
  note: "Задача агента",
  text: detail.value ? taskReadout(detail.value) : "Чат или задача недоступны",
}));
</script>

<template>
  <AgentTaskView
    v-if="detail && owner"
    :detail="detail"
    :project-id="projectId"
    :backend="owner.backend"
  />
  <p v-else class="gone" role="status">
    Чат этой задачи сейчас не открыт: вкладка покажет её, когда чат вернётся.
  </p>
</template>

<style scoped>
.gone {
  margin: var(--sp-4);
  color: var(--faint);
  font-size: var(--fs-sm);
}
</style>
