<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import type { QueuedMessage } from "../model/types.ts";
import IconX from "~icons/lucide/x";
import IconSend from "~icons/lucide/corner-down-right";
import IconInject from "~icons/lucide/message-square-plus";

defineProps<{ items: QueuedMessage[]; busy: boolean; canInject?: boolean }>();
const emit = defineEmits<{ now: [id: string]; inject: [id: string]; remove: [id: string] }>();
</script>

<template>
  <ul v-if="items.length" class="queue" aria-label="Сообщения в очереди">
    <li v-for="item in items" :key="item.id">
      <span class="label">В очереди</span>
      <span class="text u-truncate" :title="item.text">{{ item.text }}</span>
      <UiButton
        v-if="busy && canInject"
        shape="icon"
        size="sm"
        title="Добавить в ответ, который пишется сейчас: агент учтёт это, не останавливаясь"
        aria-label="Добавить в ответ"
        @click="emit('inject', item.id)"
      >
        <IconInject aria-hidden="true" />
      </UiButton>
      <UiButton
        v-if="busy"
        shape="icon"
        size="sm"
        title="Остановить ответ и отправить это сообщение сразу"
        aria-label="Отправить сразу"
        @click="emit('now', item.id)"
      >
        <IconSend aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        title="Убрать из очереди"
        aria-label="Убрать из очереди"
        @click="emit('remove', item.id)"
      >
        <IconX aria-hidden="true" />
      </UiButton>
    </li>
  </ul>
</template>

<style scoped>
.queue {
  display: grid;
  gap: 4px;
  margin: 0 0 var(--sp-2);
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  padding: 2px var(--sp-2) 2px var(--sp-3);
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-lg);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.label {
  flex-shrink: 0;
  color: var(--faint);
}
.text {
  min-width: 0;
  flex: 1;
  color: var(--text-2);
}
svg {
  width: 13px;
  height: 13px;
}
</style>
