<script setup lang="ts">
import { computed } from "vue";
import { normalizeOptions, useField, type WidgetOption } from "./form.ts";
const props = defineProps<{
  options: (string | WidgetOption)[];
  single?: boolean;
  /** Field name inside a `<Form>`. */
  name?: string;
  initial?: string[];
}>();
const model = defineModel<string[]>();
useField(props.name, model, props.initial ?? []);
const items = computed(() => normalizeOptions(props.options));
const chosen = computed(() => model.value ?? []);

function toggle(value: string, single?: boolean) {
  if (single) model.value = [value];
  else
    model.value = chosen.value.includes(value)
      ? chosen.value.filter((item) => item !== value)
      : [...chosen.value, value];
}
</script>

<template>
  <ul class="checks">
    <li v-for="option in items" :key="option.value">
      <label>
        <input
          :type="single ? 'radio' : 'checkbox'"
          :checked="chosen.includes(option.value)"
          @change="toggle(option.value, single)"
        />
        <span class="text">
          <span>{{ option.label ?? option.value }}</span>
          <small v-if="option.hint">{{ option.hint }}</small>
        </span>
      </label>
    </li>
  </ul>
</template>

<style scoped>
.checks {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
label {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  font-size: var(--fs-xs);
  cursor: pointer;
}
input {
  margin-top: 2px;
  accent-color: var(--info);
}
.text {
  display: grid;
}
small {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
