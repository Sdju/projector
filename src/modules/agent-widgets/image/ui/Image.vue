<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  src: string;
  alt: string;
  caption?: string;
  fit?: "contain" | "cover";
  height?: number;
}>();

const style = computed(() => ({
  height: `${Math.max(80, Math.min(1200, props.height ?? 240))}px`,
  objectFit: props.fit ?? "contain",
}));
</script>

<template>
  <figure class="image">
    <img :src="src" :alt="alt" :style="style" loading="lazy" referrerpolicy="no-referrer" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.image {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  min-width: 0;
}
img {
  display: block;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
}
figcaption {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
