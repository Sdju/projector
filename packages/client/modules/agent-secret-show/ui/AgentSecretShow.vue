<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiSecretValue from "../../../common/ui/UiSecretValue.vue";
import type { AgentSecretShowItem } from "../model/secret-shows.ts";
import IconClose from "~icons/lucide/x";
import IconKey from "~icons/lucide/key-round";

defineProps<{ items: AgentSecretShowItem[] }>();
const emit = defineEmits<{ dismiss: [id: string] }>();
</script>

<template>
  <div
    v-if="items.length"
    class="secret-shows"
    role="region"
    aria-live="polite"
    aria-label="Секреты от агента"
  >
    <UiCard
      v-for="item in items"
      :key="item.id"
      as="section"
      tone="warning"
      density="notice"
      class="secret-show"
    >
      <UiInline as="header" align="center" justify="between">
        <UiInline align="center" justify="normal" class="heading">
          <IconKey aria-hidden="true" />
          <span class="title">{{ item.label || "Секрет от агента" }}</span>
        </UiInline>
        <UiButton
          shape="icon"
          size="sm"
          aria-label="Закрыть"
          title="Закрыть"
          @click="emit('dismiss', item.id)"
        >
          <IconClose aria-hidden="true" />
        </UiButton>
      </UiInline>
      <p v-if="item.comment" class="comment">{{ item.comment }}</p>
      <UiSecretValue :value="item.secret" :label="item.label || 'Секрет'" />
      <p class="note">Панель видна только в этом окне; агент секрет не получает.</p>
    </UiCard>
  </div>
</template>

<style scoped>
.secret-shows {
  display: grid;
  gap: var(--sp-2);
}
.secret-show {
  gap: var(--sp-3);
  font-size: var(--fs-md);
  line-height: 1.5;
}
.heading {
  min-width: 0;
}
.heading svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--warn);
}
.title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}
.comment,
.note {
  margin: 0;
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.comment {
  color: var(--text-2);
}
.note {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
