<script setup lang="ts">
import { computed } from "vue";
import {
  judgeDecisionLabel,
  type JudgeDecision,
  type JudgeVerdict,
} from "@ai-projector/core/modules/agent-judge/index.ts";
import { permissionRiskClass } from "../lib/permission-risk.ts";
import IconShieldCheck from "~icons/lucide/shield-check";
import IconShieldAlert from "~icons/lucide/shield-alert";
import IconShieldX from "~icons/lucide/shield-x";

const props = defineProps<{
  tool: string;
  title?: string;
  verdict: JudgeVerdict;
  decision: JudgeDecision;
}>();
const risk = computed(() => permissionRiskClass(props.verdict));
const name = computed(() => props.title?.trim() || props.tool);
const decision = computed(() => judgeDecisionLabel(props.decision));
</script>

<template>
  <p class="judge-note">
    <span
      class="judge-mark"
      :class="risk"
      :title="`Судья: риск ${verdict.score}/5 · ${verdict.label}`"
    >
      <IconShieldCheck v-if="verdict.score <= 2" aria-hidden="true" />
      <IconShieldAlert v-else-if="verdict.score === 3" aria-hidden="true" />
      <IconShieldX v-else aria-hidden="true" />
      <span class="judge-score">{{ verdict.score }}/5</span>
    </span>
    <span class="judge-text">
      <strong>{{ name }}</strong> — {{ verdict.reason }}. {{ decision }}.
    </span>
  </p>
</template>

<style scoped>
.judge-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.judge-mark {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  margin-top: 1px;
  gap: 2px;
}
.judge-mark svg {
  width: 14px;
  height: 14px;
}
.judge-score {
  font: 600 10px/1 var(--mono);
}
.judge-mark.risk-1 {
  color: var(--run);
}
.judge-mark.risk-2 {
  color: var(--info);
}
.judge-mark.risk-3 {
  color: var(--warn);
}
.judge-mark.risk-4,
.judge-mark.risk-5 {
  color: var(--err);
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
