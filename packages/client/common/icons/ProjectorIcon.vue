<script setup lang="ts">
import { computed } from "vue";
import { resolveIcon } from "./registry.ts";

const props = defineProps<{
  /** Icon name: `chevron-right` for Lucide, `simple-icons:github` for another set. */
  name: string;
  /** Accessible name; without it the icon is decorative. */
  label?: string;
}>();

const icon = computed(() => resolveIcon(props.name));
</script>

<template>
  <component
    :is="icon"
    class="projector-icon"
    :aria-hidden="label ? undefined : 'true'"
    :role="label ? 'img' : undefined"
    :aria-label="label"
  />
</template>

<style scoped>
/* Decorative icon: clicks and HTML5 drag hit-testing belong to the button or row around it. */
.projector-icon {
  pointer-events: none;
}
</style>
