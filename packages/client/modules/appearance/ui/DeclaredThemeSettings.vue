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
    <UiControl
      v-if="field.kind === 'wallpaper'"
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
</style>
