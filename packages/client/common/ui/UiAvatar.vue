<script setup lang="ts">
import { ref, watch } from "vue";
const props = withDefaults(defineProps<{ src?: string; alt?: string; size?: number }>(), {
  src: "",
  alt: "",
  size: 16,
});
const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
function initial() {
  return (props.alt || "?").trim().slice(0, 1).toUpperCase() || "?";
}
</script>

<template>
  <span class="ui-avatar" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" @error="failed = true" />
    <span v-else class="fallback" aria-hidden="true">{{ initial() }}</span>
  </span>
</template>

<style scoped>
.ui-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--r-full);
  overflow: hidden;
  background: var(--active);
  color: var(--muted);
}
.ui-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fallback {
  font-size: var(--fs-2xs);
  font-weight: 500;
}
</style>
