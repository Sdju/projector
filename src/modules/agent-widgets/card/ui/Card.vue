<script setup lang="ts">
import UiCard from "../../../../common/ui/UiCard.vue";

defineProps<{ title?: string; hint?: string; tone?: "neutral" | "warning" }>();
</script>

<template>
  <UiCard :tone="tone">
    <header v-if="title || hint" class="head">
      <strong v-if="title" class="title">{{ title }}</strong>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </header>
    <slot />
  </UiCard>
</template>

<style scoped>
.head {
  display: grid;
  gap: 2px;
}
.title {
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.hint {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
