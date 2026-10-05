<script setup lang="ts">
import { ref, useId } from "vue";
import IconRemove from "~icons/lucide/x";
import UiButton from "./UiButton.vue";

const props = withDefaults(
  defineProps<{
    items: string[];
    disabled?: boolean;
    placeholder?: string;
    addLabel?: string;
    emptyText?: string;
    inputLabel?: string;
    /** Monospace input and row values (paths, globs, ids). */
    mono?: boolean;
    /** Reject duplicates already present in `items`. */
    unique?: boolean;
    normalize?: (value: string) => string;
    /** Empty string when valid. */
    validate?: (value: string) => string;
  }>(),
  {
    addLabel: "Добавить",
    emptyText: "Список пуст",
    inputLabel: "Новое значение",
    unique: true,
  },
);

const emit = defineEmits<{
  add: [value: string];
  remove: [value: string];
}>();

const draft = ref("");
const error = ref("");
const inputId = useId();

function submit() {
  error.value = "";
  const raw = draft.value.trim();
  if (!raw) return;
  const value = props.normalize?.(raw) ?? raw;
  const invalid = props.validate?.(value) ?? "";
  if (invalid) {
    error.value = invalid;
    return;
  }
  if (props.unique && props.items.includes(value)) {
    error.value = "Уже в списке";
    return;
  }
  draft.value = "";
  emit("add", value);
}

function remove(value: string) {
  error.value = "";
  emit("remove", value);
}
</script>

<template>
  <div class="string-list" :aria-busy="disabled">
    <ul class="items">
      <li v-for="item in items" :key="item">
        <span class="value" :class="{ mono }">{{ item }}</span>
        <UiButton
          icon
          size="sm"
          :disabled="disabled"
          :aria-label="`Удалить ${item}`"
          title="Удалить"
          @click="remove(item)"
          ><IconRemove
        /></UiButton>
      </li>
      <li v-if="!items.length" class="empty">{{ emptyText }}</li>
    </ul>
    <form class="add" @submit.prevent="submit">
      <label class="sr-only" :for="inputId">{{ inputLabel }}</label>
      <input
        :id="inputId"
        v-model="draft"
        type="text"
        :class="{ mono }"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? true : undefined"
        autocomplete="off"
        spellcheck="false"
      />
      <UiButton type="submit" :disabled="disabled || !draft.trim()">{{ addLabel }}</UiButton>
      <slot name="actions" />
    </form>
    <p v-if="error" class="error" role="status">{{ error }}</p>
  </div>
</template>

<style scoped>
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 520px;
}
li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--line);
}
.value {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--fs-sm);
}
.empty {
  color: var(--muted);
  font-size: var(--fs-sm);
  border-bottom: 0;
}
.add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
  max-width: 520px;
}
.add input {
  flex: 1;
  min-width: 12rem;
}
.mono,
.mono.value {
  font-family: var(--font-mono, ui-monospace, monospace);
}
.error {
  margin: var(--sp-2) 0 0;
  color: var(--err);
  font-size: var(--fs-sm);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
