<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { frostedSeedHex } from "@ai-projector/core/modules/appearance/index.ts";
import type { ThemeSetting } from "@ai-projector/core/modules/plugins/index.ts";
import UiControl from "../../../common/ui/UiControl.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiLabel from "../../../common/ui/UiLabel.vue";

const hexColor = /^#[0-9a-f]{6}$/i;
const props = defineProps<{
  field: Extract<ThemeSetting, { kind: "seed" }>;
  disabled: boolean;
}>();
const seed = defineModel<string>({ required: true });
const seedId = useId();
const customSelected = computed(() => hexColor.test(seed.value));
const customHex = ref(customSelected.value ? seed.value.toLowerCase() : "#e07a5f");
const frostedTone = computed(() => frostedSeedHex(customHex.value));

watch(seed, (value) => {
  if (hexColor.test(value)) customHex.value = value.toLowerCase();
});

function setCustom(hex: string) {
  const next = hex.toLowerCase();
  customHex.value = next;
  seed.value = next;
}
</script>

<template>
  <div class="seed-setting">
    <UiLabel :id="seedId" as="span">{{ field.title }}</UiLabel>
    <div class="seed-options" role="radiogroup" :aria-labelledby="seedId">
      <label v-for="option in field.options" :key="option.id" class="seed-option">
        <UiControl
          type="radio"
          :name="seedId"
          :value="option.id"
          :disabled="disabled"
          :model-value="seed"
          @update:model-value="seed = String($event)"
        />
        <span class="seed-swatch" :style="{ background: option.color }" />
        {{ option.title }}
      </label>
      <label v-if="field.custom" class="seed-option">
        <UiControl
          type="radio"
          :name="seedId"
          value="custom"
          :disabled="disabled"
          :model-value="customSelected ? 'custom' : seed"
          @update:model-value="setCustom(customHex)"
        />
        <UiControl
          type="color"
          appearance="swatch"
          swatch-size="sm"
          aria-label="Свой опорный цвет"
          :disabled="disabled"
          :model-value="customHex"
          @update:model-value="setCustom(String($event))"
        />
        <span
          class="seed-swatch"
          :style="{ background: frostedTone }"
          :title="`Холодная вариация ${frostedTone}`"
        />
        Свой
      </label>
    </div>
    <UiHint v-if="field.hint">{{ field.hint }}</UiHint>
  </div>
</template>

<style scoped>
.seed-setting {
  display: grid;
  gap: var(--sp-2);
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
  padding: 4px 8px 4px 4px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-xs);
}
.seed-option:has(:checked) {
  border-color: var(--focus);
}
.seed-option:has(:disabled) {
  cursor: not-allowed;
}
.seed-swatch {
  width: 16px;
  height: 16px;
  border-radius: var(--r-full);
  box-shadow: inset 0 0 0 1px #0003;
}
.seed-option :deep(.ui-control-swatch) {
  width: 18px;
  height: 18px;
}
</style>
