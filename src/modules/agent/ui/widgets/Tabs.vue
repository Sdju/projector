<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { normalizeOptions, useField, type WidgetOption } from "./form.ts";
import { tabsKey } from "./tabs.ts";

/**
 * Two uses: a selector (`:options`, the value is the chosen option) or a container of
 * `<Tab title>` panels. Only the selector takes part in a form.
 */
const props = defineProps<{
  options?: (string | WidgetOption)[];
  /** Field name inside a `<Form>` (selector only). */
  name?: string;
  initial?: string;
}>();
const model = defineModel<string>();
const selector = props.options !== undefined;
const items = computed(() => normalizeOptions(props.options));
const panels = ref<WidgetOption[]>([]);
if (selector) useField(props.name, model, props.initial ?? items.value[0]?.value ?? "");
const entries = computed(() => (selector ? items.value : panels.value));
const active = computed(() => model.value ?? props.initial ?? entries.value[0]?.value);
provide(tabsKey, {
  active,
  register(title, hint) {
    const panel = { value: title, hint };
    panels.value = [...panels.value, panel];
    return () => (panels.value = panels.value.filter((item) => item !== panel));
  },
});
</script>

<template>
  <div class="tabs-host">
    <div class="tabs" role="tablist">
      <button
        v-for="option in entries"
        :key="option.value"
        type="button"
        role="tab"
        :aria-selected="active === option.value"
        :class="{ on: active === option.value }"
        :title="option.hint"
        @click="model = option.value"
      >
        {{ option.label ?? option.value }}
      </button>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.tabs {
  display: inline-flex;
  flex-wrap: wrap;
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
