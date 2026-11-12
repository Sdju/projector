<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentFormPanel } from "../../agent-turns/index.ts";
import { computed, ref, watch } from "vue";
import type { AgentPresetView } from "@ai-projector/core/modules/agent-preset/index.ts";

const props = defineProps<{ presets: AgentPresetView[]; projectId?: string }>();
const emit = defineEmits<{
  suggest: [text: string];
  form: [preset: AgentPresetView, text: string, data: unknown, summary?: string];
}>();

const projectPresets = computed(() =>
  props.presets.filter((preset) => preset.source === "project"),
);
const globalPresets = computed(() => props.presets.filter((preset) => preset.source !== "project"));
const active = ref<AgentPresetView>();
watch(
  () => props.presets,
  (list) => {
    if (active.value && !list.some((preset) => preset.id === active.value?.id))
      active.value = undefined;
  },
);

function choose(preset: AgentPresetView) {
  if (preset.form) {
    active.value = preset;
    return;
  }
  emit("suggest", preset.prompt);
}

function submit(text: string, data: unknown, summary?: string) {
  if (active.value) emit("form", active.value, text, data, summary);
}
</script>

<template>
  <div v-if="presets.length" class="presets">
    <template v-if="!active">
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
            :title="preset.description || (preset.form ? 'Откроет форму' : preset.prompt)"
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
            :title="preset.description || (preset.form ? 'Откроет форму' : preset.prompt)"
            @click="choose(preset)"
          >
            {{ preset.title }}<span v-if="preset.form" class="kind">форма</span>
          </UiButton>
        </div>
      </section>
    </template>
    <div v-else class="form">
      <div class="form-head">
        <div>
          <strong>{{ active.title }}</strong>
          <p v-if="active.description">{{ active.description }}</p>
        </div>
        <UiButton
          appearance="quiet"
          tone="muted"
          size="sm"
          type="button"
          @click="active = undefined"
          >Закрыть</UiButton
        >
      </div>
      <AgentFormPanel :source="active.form ?? ''" :project-id="projectId" @submit="submit" />
    </div>
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
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  text-align: left;
}
.form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}
.form-head strong {
  font-size: var(--fs-sm);
  font-weight: 500;
}
.form-head p {
  margin: var(--sp-1) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
