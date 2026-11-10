<script setup lang="ts">
import UiHint from "./UiHint.vue";
import UiLoader from "./UiLoader.vue";

/** Column panel that owns the loading/error state and renders its content only when ready. */
defineProps<{ loading: boolean; error: string; loadingText?: string }>();
</script>

<template>
  <div class="loadable-panel">
    <UiLoader v-if="loading" class="note">{{ loadingText ?? "загрузка…" }}</UiLoader>
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <slot v-else />
  </div>
</template>

<style scoped>
.loadable-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
}
</style>
