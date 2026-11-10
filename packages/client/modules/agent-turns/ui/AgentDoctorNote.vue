<script setup lang="ts">
import { computed } from "vue";
import UiTooltip from "../../../common/ui/UiTooltip.vue";
import type { AgentDoctorProgress, AgentDoctorReport } from "../../agent-core/index.ts";
import IconStethoscope from "~icons/lucide/stethoscope";

/** The answer mark that shows why and how Answer Doctor touched the visible markup. */
const props = defineProps<{
  /** The saved outcome: the mark stays after a fix, including after a reload. */
  report?: AgentDoctorReport;
  /** What the doctor is doing right now; absent until the check finds a problem. */
  live?: AgentDoctorProgress;
}>();
const emit = defineEmits<{ retry: [] }>();

function attemptsWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "попыток";
  if (last === 1) return "попытка";
  if (last >= 2 && last <= 4) return "попытки";
  return "попыток";
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} мс`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} с`;
}

const shown = computed(() => Boolean(props.live ?? props.report));
const failed = computed(
  () => props.live?.status === "failed" || (!props.live && props.report?.status === "failed"),
);
const tone = computed(() => {
  if (props.live) return failed.value ? "failed" : "repairing";
  return failed.value ? "failed" : "fixed";
});
const attempts = computed(() => props.live?.attempts ?? props.report?.attempts ?? 0);
const canRetry = computed(() => failed.value && props.live?.status !== "repairing");
const problem = computed(() => props.live?.problem ?? props.report?.problem ?? "");
const remaining = computed(() => {
  const value = props.live?.remaining ?? props.report?.remaining;
  return value && value !== problem.value ? value : "";
});
const summary = computed(() => {
  if (props.live?.status === "repairing")
    return "Проверяю разметку и переписываю то, что сломалось.";
  if (failed.value) return "Исправить разметку не удалось: показан исходный ответ.";
  return "Разметку исправил; ответ сохранён уже исправленным.";
});
const label = computed(() => {
  if (props.live?.status === "repairing")
    return `Доктор ответов исправляет разметку: попытка ${props.live.attempts} из ${props.live.limit}`;
  if (failed.value)
    return "Доктор ответов не справился с разметкой ответа. Нажмите, чтобы повторить попытку";
  return `Ответ исправлен доктором: ${attempts.value} ${attemptsWord(attempts.value)}`;
});
</script>

<template>
  <UiTooltip v-if="shown" class="doctor" :class="{ active: live?.status === 'repairing' }">
    <template #default="{ describedby }">
      <component
        :is="canRetry ? 'button' : 'span'"
        class="doctor-mark"
        :class="tone"
        :type="canRetry ? 'button' : undefined"
        :role="live?.status === 'repairing' ? 'status' : undefined"
        :aria-label="label"
        :aria-describedby="describedby"
        :tabindex="canRetry ? undefined : 0"
        @click="canRetry && emit('retry')"
      >
        <IconStethoscope class="doctor-icon" aria-hidden="true" />
      </component>
    </template>
    <template #content>
      <span class="doctor-title"><strong>Доктор ответов</strong></span>
      <span class="doctor-line">{{ summary }}</span>
      <span class="doctor-line doctor-detail">Нашёл: {{ problem }}</span>
      <span v-if="remaining" class="doctor-line doctor-detail"
        >Последняя проверка: {{ remaining }}</span
      >
      <span v-if="live" class="doctor-line doctor-detail"
        >Попытка: {{ live.attempts }} из {{ live.limit }}</span
      >
      <span v-else-if="report" class="doctor-line doctor-detail"
        >Попыток: {{ report.attempts }} · заняло {{ duration(report.took) }}</span
      >
      <span v-if="canRetry" class="doctor-line doctor-detail"
        >Нажмите, чтобы попробовать ещё раз</span
      >
    </template>
  </UiTooltip>
</template>

<style scoped>
.doctor {
  display: inline-flex;
  margin-top: var(--sp-1);
}
.doctor-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: 0;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--muted);
  font: inherit;
  outline: none;
  cursor: default;
}
button.doctor-mark {
  cursor: pointer;
}
button.doctor-mark:hover,
.doctor-mark:focus-visible {
  background: var(--hover);
}
.doctor-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.doctor-mark.fixed .doctor-icon {
  color: var(--run);
}
.doctor-mark.failed {
  color: var(--err);
}
.doctor-mark.repairing .doctor-icon {
  color: var(--text-2);
  animation: doctor-pulse 1.4s ease-in-out infinite;
}
.doctor-title {
  display: block;
  margin-bottom: var(--sp-1);
}
.doctor-line {
  display: block;
}
.doctor-detail {
  margin-top: var(--sp-1);
  color: var(--muted);
}
@keyframes doctor-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}
@media (prefers-reduced-motion: reduce) {
  .doctor-mark.repairing .doctor-icon {
    animation: none;
    opacity: 0.7;
  }
}
</style>
