<script setup lang="ts">
import { computed } from "vue";
import { icons } from "../../_/index.ts";

const props = defineProps<{ name: string; label?: string }>();
const icon = computed(() => icons[props.name]);
</script>

<template>
  <span v-if="icon" class="inline-icon" role="img" :aria-label="label" :aria-hidden="!label">
    <component :is="icon" />
  </span>
  <span v-else class="inline-icon missing" :title="`Нет иконки ${name}`" aria-hidden="true">•</span>
</template>

<style scoped>
.inline-icon {
  display: inline-grid;
  place-items: center;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
  color: currentColor;
}
.inline-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2;
}
.missing {
  color: var(--muted);
}
</style>
