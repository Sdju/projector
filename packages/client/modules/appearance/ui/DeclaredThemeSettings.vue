<script setup lang="ts">
import { useId } from "vue";
import type { ThemeSetting, ThemeValues } from "@ai-projector/core/modules/plugins/index.ts";
import UiControl from "../../../common/ui/UiControl.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiLabel from "../../../common/ui/UiLabel.vue";

defineProps<{ fields: readonly ThemeSetting[]; disabled: boolean }>();
const values = defineModel<ThemeValues>({ required: true });
const emit = defineEmits<{ submit: [] }>();
const prefix = useId();
</script>

<template>
  <div v-for="field in fields" :key="field.id">
    <UiLabel :for="`${prefix}-${field.id}`" :space-before="3" :space-after="2">
      {{ field.title
      }}<template v-if="field.kind === 'blur'"> · {{ values[field.id] }} px</template>
    </UiLabel>
    <div v-if="field.kind === 'seed'" class="seed-options" role="radiogroup">
      <label v-for="option in field.options" :key="option.id" class="seed-option">
        <UiControl
          type="radio"
          :name="`${prefix}-${field.id}`"
          :value="option.id"
          :disabled="disabled"
          :model-value="values[field.id]"
          @update:model-value="values = { ...values, [field.id]: String($event) }"
        />
        <span class="seed-swatch" :style="{ background: option.color }" />
        {{ option.title }}
      </label>
    </div>
    <UiControl
      v-else-if="field.kind === 'wallpaper'"
      :id="`${prefix}-${field.id}`"
      type="url"
      maxlength="4096"
      placeholder="https://…"
      :disabled="disabled"
      :model-value="values[field.id]"
      @update:model-value="values = { ...values, [field.id]: String($event) }"
      @keydown.enter.prevent="emit('submit')"
    />
    <UiControl
      v-else
      :id="`${prefix}-${field.id}`"
      type="range"
      :min="field.min"
      :max="field.max"
      :step="1"
      :disabled="disabled"
      :model-value="values[field.id]"
      @update:model-value="values = { ...values, [field.id]: Number($event) }"
    />
    <UiHint v-if="field.hint">{{ field.hint }}</UiHint>
  </div>
</template>

<style scoped>
input[type="range"] {
  max-width: 320px;
}
.seed-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.seed-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
}
.seed-swatch {
  width: 14px;
  height: 14px;
  border-radius: var(--r-full);
  box-shadow: inset 0 0 0 1px var(--line);
}
</style>
