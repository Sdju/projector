<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import AgentMarkdown from "./AgentMarkdown.vue";
import {
  AgentWidget,
  ensureProjectWidgets,
  isWidgetName,
  projectWidgetsVersion,
  splitMessage,
  useMessageScope,
} from "../../widget-runtime/index.ts";

const props = defineProps<{
  text: string;
  streaming?: boolean;
  promoted?: string;
  /** The promoted form was already sent: the user's snapshot below shows it. */
  answered?: boolean;
  /** The project whose trusted widgets this answer may use. */
  projectId?: string;
}>();
watch(
  () => props.projectId,
  (projectId) => void ensureProjectWidgets(projectId),
  { immediate: true },
);
// Text only grows, so earlier parts keep their position and source: Vue patches only the tail.
const parts = computed(() => {
  void projectWidgetsVersion.value;
  return splitMessage(props.text, {
    known: (name) => isWidgetName(name, props.projectId),
    streaming: props.streaming,
  });
});
// The message's own `<script>`s run once into a scope its components share.
const scriptErrors = ref<string[]>([]);
useMessageScope(
  parts,
  toRef(() => !props.streaming),
  scriptErrors,
);
</script>

<template>
  <div class="agent-message">
    <template v-for="(part, index) in parts" :key="index">
      <AgentMarkdown v-if="part.type === 'markdown'" :text="part.text" :streaming="streaming" />
      <template v-else-if="part.type === 'widget' && part.source === promoted">
        <!-- A sent form lives in the user's snapshot; the active one lives in the composer. -->
        <p v-if="answered && part.name !== 'IntelligentForm'" class="promoted-form">
          <span aria-hidden="true">✓</span> Ответ отправлен в форме.
        </p>
        <p v-else-if="!answered && part.name !== 'IntelligentForm'" class="promoted-form">
          <span aria-hidden="true">↓</span> Форма доступна в поле ввода.
        </p>
      </template>
      <AgentWidget
        v-else-if="part.type === 'widget'"
        :source="part.source"
        :complete="part.complete"
        :project-id="projectId"
      />
    </template>
    <p v-for="error in scriptErrors" :key="error" class="script-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.script-error {
  color: var(--err);
  font-size: var(--fs-xs);
}
.promoted-form {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 12px 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.promoted-form span {
  color: var(--text-2);
}
.agent-message {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
</style>
