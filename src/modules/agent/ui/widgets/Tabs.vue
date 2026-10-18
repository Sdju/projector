<script setup lang="ts">
import { computed } from "vue";
import { normalizeOptions, useField, type WidgetOption } from "./form.ts";
const props = defineProps<{
  options: (string | WidgetOption)[];
  /** Field name inside a `<Form>`. */
  name?: string;
  initial?: string;
}>();
const model = defineModel<string>();
const items = computed(() => normalizeOptions(props.options));
useField(props.name, model, props.initial ?? items.value[0]?.value ?? "");
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="option in items"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :class="{ on: model === option.value }"
      :title="option.hint"
      @click="model = option.value"
    >
      {{ option.label ?? option.value }}
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-md);
  background: var(--bg-3);
}
button {
  padding: 4px 12px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.on {
  background: var(--bg-2);
  color: var(--text);
}
</style>
