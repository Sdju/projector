<script setup lang="ts">
import ProjectorIcon from "../../../../common/icons/ProjectorIcon.vue";
import { hasIcon } from "../../../../common/icons/registry.ts";

const props = defineProps<{ name: string; label?: string }>();
</script>

<template>
  <span
    v-if="hasIcon(name)"
    class="inline-icon"
    role="img"
    :aria-label="label"
    :aria-hidden="!label"
  >
    <ProjectorIcon :name="name" />
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
