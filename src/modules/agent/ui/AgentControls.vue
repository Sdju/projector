<script setup lang="ts">
import type { AgentControl } from "../model/types.ts";

defineProps<{ controls: AgentControl[]; disabled: boolean }>();
const emit = defineEmits<{ change: [id: string, value: string] }>();

function hint(control: AgentControl): string {
  const option = control.options.find((item) => item.value === control.current);
  return [control.name, option?.description || control.description].filter(Boolean).join(" — ");
}
</script>

<template>
  <div v-if="controls.length" class="agent-controls" role="group" aria-label="Параметры агента">
    <label
      v-for="control in controls"
      :key="control.id"
      class="control"
      :data-category="control.category"
      :title="hint(control)"
    >
      <span class="caption">{{ control.name }}</span>
      <select
        :value="control.current"
        :disabled="disabled"
        :aria-label="control.name"
        @change="emit('change', control.id, ($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="option in control.options"
          :key="option.value"
          :value="option.value"
          :title="option.description"
        >
          {{ option.name }}
        </option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.agent-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  padding: 0 12px;
  min-width: 0;
}
.control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font: var(--fs-2xs) var(--mono);
  color: var(--faint);
}
.caption {
  white-space: nowrap;
}
select {
  min-width: 0;
  max-width: 190px;
  padding: 2px 2px;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  text-overflow: ellipsis;
  cursor: pointer;
}
.control[data-category="model"] select {
  max-width: 240px;
}
select:hover:not(:disabled),
select:focus-visible {
  color: var(--text);
}
select:disabled {
  cursor: default;
  opacity: 0.6;
}
@container (max-width: 500px) {
  .caption {
    display: none;
  }
  select {
    max-width: 140px;
  }
}
</style>
