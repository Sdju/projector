<script setup lang="ts">
import { useId } from "vue";
import { frozenGlass } from "@ai-projector/core/modules/appearance/index.ts";
import type { ThemeValues } from "@ai-projector/core/modules/plugins/index.ts";
import UiControl from "../../../common/ui/UiControl.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiLabel from "../../../common/ui/UiLabel.vue";

defineProps<{ disabled: boolean }>();
const values = defineModel<ThemeValues>({ required: true });
const emit = defineEmits<{ submit: [] }>();
const wallpaperId = useId();
const blurId = useId();
const [wallpaper, blur] = frozenGlass.settings;
</script>

<template>
  <div>
    <UiLabel :for="wallpaperId" :space-before="3" :space-after="2">{{ wallpaper.title }}</UiLabel>
    <UiControl
      :id="wallpaperId"
      type="url"
      maxlength="4096"
      placeholder="https://…"
      :disabled="disabled"
      :model-value="values[wallpaper.id]"
      @update:model-value="values = { ...values, [wallpaper.id]: String($event) }"
      @keydown.enter.prevent="emit('submit')"
    />
    <UiHint>{{ wallpaper.hint }}</UiHint>
  </div>
  <div>
    <UiLabel :for="blurId" :space-before="3" :space-after="2">
      {{ blur.title }} · {{ values[blur.id] }} px
    </UiLabel>
    <UiControl
      :id="blurId"
      type="range"
      :min="blur.min"
      :max="blur.max"
      :step="1"
      :disabled="disabled"
      :model-value="values[blur.id]"
      @update:model-value="values = { ...values, [blur.id]: Number($event) }"
    />
  </div>
</template>

<style scoped>
input[type="range"] {
  max-width: 320px;
}
</style>
