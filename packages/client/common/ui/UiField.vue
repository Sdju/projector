<script setup lang="ts">
import { computed, useId } from "vue";

const props = defineProps<{
  label: string;
  /** Caption keeps the existing compact uppercase label; plain uses inherited typography. */
  layout?: "caption" | "plain";
  as?: "div" | "label";
  for?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  gap?: 1 | 2 | 3;
}>();
const id = useId();
const controlId = computed(() => props.for ?? id);
const tag = computed(() => props.as ?? (props.layout === "plain" ? "label" : "div"));
/** Bind to the native control; native v-model and composition handling stay with its owner. */
const control = computed(() => ({
  id: controlId.value,
  required: props.required || undefined,
  "aria-invalid": props.error ? true : undefined,
  "aria-describedby":
    [props.hint && `${id}-hint`, props.error && `${id}-error`].filter(Boolean).join(" ") ||
    undefined,
}));
</script>

<template>
  <component
    :is="tag"
    class="field"
    :class="layout ?? 'caption'"
    :for="tag === 'label' ? controlId : undefined"
    :style="gap === undefined ? undefined : { gap: `var(--sp-${gap})` }"
  >
    <template v-if="layout === 'plain'">{{ label }}</template>
    <component
      :is="tag === 'label' ? 'span' : 'label'"
      v-else
      class="field-label"
      :for="tag === 'label' ? undefined : controlId"
      >{{ label }}</component
    >
    <slot :control="control" />
    <!-- Descriptions inside a wrapping label must not become part of the control's name.
         aria-describedby still exposes the explicitly referenced text. -->
    <span
      v-if="hint"
      :id="`${id}-hint`"
      class="field-hint"
      :aria-hidden="tag === 'label' || undefined"
      >{{ hint }}</span
    >
    <span
      v-if="error"
      :id="`${id}-error`"
      class="field-error"
      :aria-hidden="tag === 'label' || undefined"
      >{{ error }}</span
    >
  </component>
</template>

<style scoped>
.field {
  display: grid;
  gap: 6px;
}

.field-label {
  color: var(--muted);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}

.plain {
  gap: var(--sp-2);
  min-width: 0;
  color: var(--muted);
}

.field-hint,
.field-error {
  font-size: var(--fs-2xs);
  line-height: var(--lh);
  overflow-wrap: anywhere;
}
.field-hint {
  color: var(--muted);
}
.field-error {
  color: var(--err);
}
</style>
