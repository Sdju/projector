<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import { nextTick, ref, watch } from "vue";
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";

const props = defineProps<{
  text: string;
  /** The agent is still reasoning: the block is open and follows the text. */
  streaming: boolean;
}>();
const body = ref<HTMLElement>();

watch(
  () => props.text,
  async () => {
    if (!props.streaming) return;
    await nextTick();
    if (body.value) body.value.scrollTop = body.value.scrollHeight;
  },
);
</script>

<template>
  <details class="thought" :open="streaming || undefined">
    <UiDisclosureSummary variant="fit" class="thought-summary">
      <UiSpinner v-if="streaming" />
      <ProjectorIcon name="brain" v-else class="thought-icon" aria-hidden="true" />
      <span>{{ streaming ? "Думает…" : "Рассуждения" }}</span>
      <ProjectorIcon name="chevron-right" class="thought-chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <div ref="body" class="thought-text">{{ text }}</div>
  </details>
</template>

<style scoped>
.thought {
  margin: 0 0 var(--sp-3);
  max-width: 100%;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.thought:last-child {
  margin-bottom: 0;
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.thought-icon {
  color: var(--faint);
}
.thought-chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.thought[open] > summary .thought-chevron {
  transform: rotate(90deg);
}
.thought-text {
  max-height: 14em;
  margin-top: var(--sp-1);
  padding: 0 0 0 var(--sp-3);
  border-left: 1px solid var(--line);
  overflow-y: auto;
  color: var(--faint);
  font-size: var(--fs-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .thought-chevron {
    transition: none;
  }
}
</style>
