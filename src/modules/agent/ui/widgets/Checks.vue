<script setup lang="ts">
defineProps<{ options: { value: string; label?: string; hint?: string }[]; single?: boolean }>();
const model = defineModel<string[]>({ required: true });

function toggle(value: string, single?: boolean) {
  if (single) model.value = [value];
  else
    model.value = model.value.includes(value)
      ? model.value.filter((item) => item !== value)
      : [...model.value, value];
}
</script>

<template>
  <ul class="checks">
    <li v-for="option in options" :key="option.value">
      <label>
        <input
          :type="single ? 'radio' : 'checkbox'"
          :checked="model.includes(option.value)"
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
