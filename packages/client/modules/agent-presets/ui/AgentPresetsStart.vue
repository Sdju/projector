<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import { computed } from "vue";
import type { AgentPresetView } from "@ai-projector/core/modules/agent-preset/index.ts";

const props = defineProps<{ presets: AgentPresetView[] }>();
const emit = defineEmits<{
  suggest: [text: string];
  form: [preset: AgentPresetView];
}>();

const projectPresets = computed(() =>
  props.presets.filter((preset) => preset.source === "project"),
);
const globalPresets = computed(() => props.presets.filter((preset) => preset.source !== "project"));

function choose(preset: AgentPresetView) {
  if (preset.form) {
    emit("form", preset);
    return;
  }
  emit("suggest", preset.prompt);
}
</script>

<template>
  <div v-if="presets.length" class="presets">
    <section v-if="projectPresets.length" class="group">
      <span class="label">Проект</span>
      <div class="chips">
        <UiButton
          v-for="preset in projectPresets"
          :key="`project-${preset.id}`"
          appearance="outline"
          tone="muted"
          shape="pill"
          type="button"
          :title="
            preset.description || (preset.form ? 'Откроет форму в поле отправки' : preset.prompt)
          "
          @click="choose(preset)"
        >
          {{ preset.title }}<span v-if="preset.form" class="kind">форма</span>
        </UiButton>
      </div>
    </section>
    <section v-if="globalPresets.length" class="group">
      <span class="label">Общие</span>
      <div class="chips">
        <UiButton
          v-for="preset in globalPresets"
          :key="`global-${preset.id}`"
          appearance="outline"
          tone="muted"
          shape="pill"
          type="button"
          :title="
            preset.description || (preset.form ? 'Откроет форму в поле отправки' : preset.prompt)
          "
          @click="choose(preset)"
        >
          {{ preset.title }}<span v-if="preset.form" class="kind">форма</span>
        </UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.presets {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  margin-top: var(--sp-3);
}
.group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
}
.label {
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
}
.kind {
  margin-left: 6px;
  padding: 0 5px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
</style>
