<script setup lang="ts">
import UiControl from "../../../../../common/ui/UiControl.vue";
import UiField from "../../../../../common/ui/UiField.vue";
import type { JudgeSettings } from "@projector/core/modules/agent-judge/index.ts";

defineProps<{ disabled?: boolean }>();
const settings = defineModel<JudgeSettings>({ required: true });

/** Nested edits mutate the object; a copy makes the change visible to the parent. */
function touch() {
  settings.value = { ...settings.value };
}
</script>

<template>
  <label class="option">
    <UiControl
      type="checkbox"
      aria-label="Показывать оценку риска"
      v-model="settings.show"
      :disabled="disabled"
      @change="touch"
    />
    <span>Показывать оценку риска в карточке подтверждения</span>
  </label>
  <label class="option">
    <UiControl
      type="checkbox"
      aria-label="Разрешать низкий риск автоматически"
      v-model="settings.auto"
      :disabled="disabled"
      @change="touch"
    />
    <span>Разрешать низкий риск автоматически</span>
  </label>
  <UiField v-slot="{ control }" label="максимальный автоматический риск">
    <UiControl
      as="select"
      v-bind="control"
      aria-label="Максимальный автоматический риск"
      v-model.number="settings.maxRisk"
      :disabled="disabled || !settings.auto"
      @change="touch"
    >
      <option :value="1">1/5 — безопасно</option>
      <option :value="2">2/5 — низкий</option>
      <option :value="3">3/5 — умеренный</option>
    </UiControl>
  </UiField>
  <UiField v-slot="{ control }" label="достаточная уверенность">
    <UiControl
      as="select"
      v-bind="control"
      aria-label="Достаточная уверенность Судьи"
      v-model="settings.confidence"
      :disabled="disabled || !settings.auto"
      @change="touch"
    >
      <option value="high">только высокая</option>
      <option value="high-medium">высокая и средняя</option>
    </UiControl>
  </UiField>
</template>

<style scoped>
.option {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--text-2);
}
</style>
