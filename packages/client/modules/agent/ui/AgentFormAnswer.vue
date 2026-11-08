<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import AgentFormPanel from "./AgentFormPanel.vue";

/**
 * The user's own answer: the form the agent offered, with the values that were sent. It is a
 * snapshot until the pencil above the message unlocks it; sending it again branches the chat.
 */
const props = defineProps<{
  source: string;
  values: unknown;
  busy?: boolean;
  /** The project whose trusted widgets the form may contain. */
  projectId?: string;
}>();
const emit = defineEmits<{ submit: [text: string, data: unknown, summary?: string] }>();

const editing = ref(false);
const readonly = computed(() => !editing.value || props.busy === true);

function start() {
  if (!props.busy) editing.value = true;
}
function cancel() {
  editing.value = false;
}
function submit(text: string, data: unknown, summary?: string) {
  editing.value = false;
  emit("submit", text, data, summary);
}
defineExpose({ start, cancel });
</script>

<template>
  <div class="answer-form" :class="{ editing }">
    <AgentFormPanel
      :source="source"
      :values="values"
      :readonly="readonly"
      :project-id="projectId"
      @submit="submit"
    />
    <div v-if="editing" class="edit-bar">
      <span>Измените ответ и нажмите кнопку в форме.</span>
      <UiButton size="sm" @click="cancel">Отмена</UiButton>
    </div>
  </div>
</template>

<style scoped>
.answer-form {
  display: grid;
  gap: var(--sp-2);
  width: 100%;
  min-width: 0;
}
.edit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
