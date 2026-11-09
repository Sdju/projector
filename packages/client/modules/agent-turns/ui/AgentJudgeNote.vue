<script setup lang="ts">
import { computed } from "vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import { judgeScoreTone, type JudgeVerdict } from "@projector/core/modules/agent-judge/index.ts";

const props = defineProps<{
  tool: string;
  title?: string;
  verdict: JudgeVerdict;
}>();
const tone = computed(() => judgeScoreTone(props.verdict.score));
const name = computed(() => props.title?.trim() || props.tool);
</script>

<template>
  <p class="judge-note">
    <span class="judge-name">Судья</span>
    <UiBadge :tone="tone">{{ verdict.score }}/5 · {{ verdict.label }}</UiBadge>
    <span class="judge-text">
      <strong>{{ name }}</strong> — {{ verdict.reason }}. Разрешено автоматически.
    </span>
  </p>
</template>

<style scoped>
.judge-note {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.judge-name {
  flex-shrink: 0;
  color: var(--text-2);
  font-weight: 600;
}
.judge-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
strong {
  color: var(--text-2);
  font-weight: 600;
}
</style>
