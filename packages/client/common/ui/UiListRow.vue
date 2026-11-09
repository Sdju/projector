<script setup lang="ts">
import UiInline from "./UiInline.vue";

/** A clickable sidebar list row: title line above the muted metadata line. */
defineProps<{ label?: string }>();
</script>

<template>
  <button type="button" class="list-row" :title="label">
    <UiInline as="span" class="title" :gap="1" align="normal" justify="normal"
      ><slot name="title"
    /></UiInline>
    <UiInline as="span" class="meta" wrap justify="normal"><slot name="meta" /></UiInline>
  </button>
</template>

<style scoped>
.list-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
  border-top: 1px solid var(--line);
}
.list-row:hover {
  background: var(--active);
  color: var(--text);
}
.title {
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.meta {
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
