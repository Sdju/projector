<script setup lang="ts">
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import IconBot from "~icons/lucide/bot";
import IconTerminal from "~icons/lucide/terminal";

/** Read-only task frame: kind icon, title, elapsed meta and actions; the body stays with the owner. */
withDefaults(
  defineProps<{
    title: string;
    hint?: string;
    meta: string;
    running?: boolean;
    kind?: string;
    label: string;
  }>(),
  { hint: "" },
);
</script>

<template>
  <section class="task-frame" :aria-label="label">
    <header class="head">
      <slot name="leading" />
      <component :is="kind === 'shell' ? IconTerminal : IconBot" class="kind" aria-hidden="true" />
      <div class="titles">
        <div class="title u-truncate" :title="hint || title">{{ title }}</div>
        <div class="meta"><UiSpinner v-if="running" />{{ meta }}</div>
      </div>
      <slot name="actions" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.task-frame {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.head svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.kind {
  color: var(--faint);
}
.titles {
  display: grid;
  min-width: 0;
  flex: 1;
}
.title {
  color: var(--text);
  font-size: var(--fs-sm);
}
.meta {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--faint);
}
</style>
