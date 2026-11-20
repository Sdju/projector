<script setup lang="ts">
import type { AvailableTheme } from "@ai-projector/core/modules/plugins/index.ts";
import { themePreviewStyle } from "./kinds.ts";

withDefaults(defineProps<{ theme: AvailableTheme; size?: "mini" | "card" }>(), { size: "card" });
</script>

<template>
  <span class="preview" :class="size" :style="themePreviewStyle(theme)" aria-hidden="true">
    <span class="sidebar"><i /><i /><i /></span>
    <span class="content"><i /><i /><b /></span>
  </span>
</template>

<style scoped>
.preview {
  display: grid;
  grid-template-columns: 28% 1fr;
  overflow: hidden;
  border: 1px solid var(--preview-line);
  border-radius: var(--r-md);
  background: var(--preview-bg);
}
.mini {
  width: 64px;
  height: 36px;
  border-radius: var(--r-sm);
}
.card {
  height: 104px;
}
.sidebar {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 8px 6px;
  background: var(--preview-panel);
}
.content {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 12px 10px;
}
.sidebar i,
.content i,
.content b {
  display: block;
  border-radius: 3px;
}
.sidebar i {
  height: 4px;
  background: var(--preview-muted);
}
.sidebar i:first-child {
  background: var(--preview-accent);
}
.content i {
  height: 5px;
  background: var(--preview-muted);
}
.content i:first-child {
  width: 70%;
  height: 7px;
  background: var(--preview-text);
}
.content b {
  width: 42%;
  height: 10px;
  background: var(--preview-accent);
}
.mini .sidebar,
.mini .content {
  gap: 3px;
  padding: 5px 4px;
}
.mini .sidebar i,
.mini .content i {
  height: 3px;
}
.mini .content b {
  height: 5px;
}
</style>
