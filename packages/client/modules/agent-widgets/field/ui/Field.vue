<script setup lang="ts">
import { computed, inject, ref, useId, watch } from "vue";
import { formKey, normalizeOptions, useField, type WidgetOption } from "../../_/form.ts";

type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "slider"
  | "select"
  | "radio"
  | "checks"
  | "switch"
  | "date"
  | "time"
  | "segmented";

type FieldValue = string | number | boolean | string[];

const props = defineProps<{
  /** `unknown` avoids Vue's Boolean casting of a polymorphic model absent from the parent. */
  modelValue?: unknown;
  type?: FieldType;
  name?: string;
  label?: string;
  hint?: string;
  /** `unknown` avoids Vue's Boolean casting when a union prop is absent. */
  initial?: unknown;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  options?: (string | WidgetOption)[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  rows?: number;
}>();
const emit = defineEmits<{ "update:modelValue": [value: FieldValue] }>();
const local = ref<FieldValue>();
watch(
  () => props.modelValue,
  (value) => {
    if (value !== undefined) local.value = value as FieldValue;
  },
  { immediate: true },
);
const model = computed<FieldValue>({
  get: () => local.value as FieldValue,
  set: (value) => {
    local.value = value;
    emit("update:modelValue", value);
  },
});
const textModel = computed<string>({
  get: () =>
    typeof model.value === "string" ? model.value : model.value == null ? "" : String(model.value),
  set: (value) => (model.value = value),
});
const numberModel = computed<number>({
  get: () => (typeof model.value === "number" ? model.value : Number(model.value) || 0),
  set: (value) => (model.value = value),
});
const booleanModel = computed<boolean>({
  get: () => model.value === true,
  set: (value) => (model.value = value),
});

const kind = computed<FieldType>(() => props.type ?? "text");
const items = computed(() => normalizeOptions(props.options));
const fallback = computed<FieldValue>(() => {
  if (props.initial !== undefined) {
    if (kind.value === "checks")
      return Array.isArray(props.initial) ? props.initial.map(String) : [];
    if (kind.value === "switch") return props.initial === true;
    if (kind.value === "number" || kind.value === "slider")
      return typeof props.initial === "number"
        ? props.initial
        : Number(props.initial) || props.min || 0;
    return typeof props.initial === "string" ? props.initial : String(props.initial);
  }
  if (kind.value === "checks") return [];
  if (kind.value === "switch") return false;
  if (kind.value === "number" || kind.value === "slider") return props.min ?? 0;
  if (kind.value === "select" || kind.value === "radio" || kind.value === "segmented")
    return items.value[0]?.value ?? "";
  return "";
});
const selected = computed(() => (Array.isArray(model.value) ? model.value.map(String) : []));
const form = inject(formKey, null);
const error = computed(() => (props.name && form ? (form.errors[props.name] ?? "") : ""));

function validateField(value: FieldValue): string | undefined {
  if (!props.required) return undefined;
  if (kind.value === "checks")
    return selected.value.length ? undefined : "Выберите хотя бы один вариант";
  if (kind.value === "switch") return value === true ? undefined : "Включите переключатель";
  if (kind.value === "number" || kind.value === "slider")
    return typeof value === "number" && Number.isFinite(value) ? undefined : "Укажите число";
  return textModel.value.trim() ? undefined : "Заполните поле";
}
useField(props.name, model, fallback.value, validateField);

const id = useId();
const controlId = `${id}-control`;
const hintId = `${id}-hint`;

function toggle(value: string) {
  const current = selected.value;
  model.value = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}
</script>

<template>
  <fieldset v-if="kind === 'checks' || kind === 'radio'" class="field choices-field">
    <legend v-if="label" class="label">
      {{ label }}<span v-if="required" class="required" aria-hidden="true">*</span>
    </legend>
    <div
      class="choices"
      :aria-required="required || undefined"
      :aria-describedby="hint ? hintId : undefined"
    >
      <label v-for="option in items" :key="option.value" class="choice">
        <input
          :type="kind === 'checks' ? 'checkbox' : 'radio'"
          :name="name"
          :value="option.value"
          :checked="selected.includes(option.value)"
          :disabled="disabled"
          @change="kind === 'checks' ? toggle(option.value) : (model = option.value)"
        />
        <span class="choice-text">
          <span>{{ option.label ?? option.value }}</span>
          <small v-if="option.hint">{{ option.hint }}</small>
        </span>
      </label>
    </div>
    <small v-if="hint" :id="hintId" class="hint">{{ hint }}</small>
    <small v-if="error" class="error" role="alert">{{ error }}</small>
  </fieldset>

  <label v-else-if="kind === 'switch'" class="field switch-field" :for="controlId">
    <span class="switch-row">
      <input
        :id="controlId"
        v-model="booleanModel"
        type="checkbox"
        role="switch"
        :name="name"
        :disabled="disabled"
        :aria-required="required || undefined"
        :aria-describedby="hint ? hintId : undefined"
      />
      <span v-if="label" class="label">
        {{ label }}<span v-if="required" class="required" aria-hidden="true">*</span>
      </span>
    </span>
    <small v-if="hint" :id="hintId" class="hint">{{ hint }}</small>
    <small v-if="error" class="error" role="alert">{{ error }}</small>
  </label>

  <label v-else-if="kind === 'segmented'" class="field">
    <span v-if="label" class="label">
      {{ label }}<span v-if="required" class="required" aria-hidden="true">*</span>
    </span>
    <span class="segmented" role="group" :aria-required="required || undefined">
      <button
        v-for="option in items"
        :key="option.value"
        type="button"
        :aria-pressed="model === option.value"
        :disabled="disabled"
        @click="model = option.value"
      >
        {{ option.label ?? option.value }}
      </button>
    </span>
    <small v-if="hint" :id="hintId" class="hint">{{ hint }}</small>
    <small v-if="error" class="error" role="alert">{{ error }}</small>
  </label>

  <label v-else class="field" :for="controlId">
    <span v-if="label" class="label">
      {{ label }}<span v-if="required" class="required" aria-hidden="true">*</span>
    </span>

    <span v-if="kind === 'number' || kind === 'slider'" class="number-row">
      <input
        v-if="kind === 'number'"
        :id="controlId"
        v-model.number="numberModel"
        type="number"
        :name="name"
        :placeholder="placeholder"
        :min="min"
        :max="max"
        :step="step"
        :required="required"
        :disabled="disabled"
        :aria-describedby="hint ? hintId : undefined"
      />
      <input
        v-else
        :id="controlId"
        v-model.number="numberModel"
        type="range"
        :name="name"
        :min="min ?? 0"
        :max="max ?? 100"
        :step="step ?? 1"
        :disabled="disabled"
        :aria-describedby="hint ? hintId : undefined"
      />
      <span v-if="unit" class="unit">{{ unit }}</span>
    </span>

    <textarea
      v-else-if="kind === 'textarea'"
      :id="controlId"
      v-model="textModel"
      :name="name"
      :rows="rows ?? 3"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :aria-describedby="hint ? hintId : undefined"
    />

    <select
      v-else-if="kind === 'select'"
      :id="controlId"
      v-model="textModel"
      :name="name"
      :required="required"
      :disabled="disabled"
      :aria-describedby="hint ? hintId : undefined"
    >
      <option v-for="option in items" :key="option.value" :value="option.value">
        {{ option.label ?? option.value }}
      </option>
    </select>

    <input
      v-else
      :id="controlId"
      v-model="textModel"
      :type="kind"
      :name="name"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :aria-describedby="hint ? hintId : undefined"
    />

    <small v-if="hint" :id="hintId" class="hint">{{ hint }}</small>
    <small v-if="error" class="error" role="alert">{{ error }}</small>
  </label>
</template>

<style scoped>
.field {
  display: grid;
  gap: 4px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: var(--fs-xs);
}
.label {
  color: var(--text);
}
.required {
  color: var(--err);
}
input,
textarea,
select {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--text);
  font: inherit;
}
textarea {
  resize: vertical;
}
input[type="range"] {
  padding: 0;
  accent-color: var(--info);
}
input[type="checkbox"],
input[type="radio"] {
  width: auto;
  padding: 0;
  accent-color: var(--info);
}
input[type="checkbox"] {
  margin-top: 2px;
}
.number-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.unit {
  flex: none;
  color: var(--muted);
}
.choices {
  display: grid;
  gap: var(--sp-2);
}
.choice {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  cursor: pointer;
}
.choice-text {
  display: grid;
}
.choice-text small,
.hint {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.error {
  color: var(--err);
  font-size: var(--fs-2xs);
}
.switch-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.segmented button {
  flex: 1 1 auto;
  padding: 5px 9px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}
.segmented button[aria-pressed="true"] {
  border-color: var(--info);
  background: var(--bg-4);
  color: var(--text);
}
.segmented button:disabled {
  cursor: default;
  opacity: 0.55;
}
</style>
