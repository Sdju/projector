<script setup lang="ts">
import { useId } from "vue";
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";

defineProps<{
  title: string;
  hint?: string;
  icon: string;
  tone?: "neutral" | "warning";
}>();
const headingId = useId();
</script>

<template>
  <section class="settings-group" :class="tone ?? 'neutral'" :aria-labelledby="headingId">
    <header class="group-heading">
      <span class="group-icon"><ProjectorIcon :name="icon" aria-hidden="true" /></span>
      <div>
        <h2 :id="headingId">{{ title }}</h2>
        <p v-if="hint">{{ hint }}</p>
      </div>
      <div v-if="$slots.actions" class="group-actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.settings-group {
  min-width: 0;
  padding: var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
}
.warning {
  border-color: color-mix(in srgb, var(--warn) 40%, var(--line));
  background: color-mix(in srgb, var(--warn) 8%, var(--bg-2));
}
.group-heading {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.group-heading h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-md);
  font-weight: 600;
}
.group-heading p {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
.group-icon {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text-2);
}
.group-icon svg {
  width: 16px;
  height: 16px;
}
.group-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-left: auto;
}
</style>
