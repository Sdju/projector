<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiTooltip from "../../../common/ui/UiTooltip.vue";
import { computed } from "vue";
import type { AgentTokens, AgentUsage, ChatUsage } from "../model/types.ts";
import IconInfo from "~icons/lucide/info";

const props = defineProps<{ usage: AgentUsage; chat?: ChatUsage }>();

const number = new Intl.NumberFormat("ru");
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";
/** Tokens read from the cache against everything the prompt held. */
function cacheRow(label: string, tokens: AgentTokens) {
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return {
    label,
    value: `${percent(tokens.cacheRead, prompt)} из кэша`,
    detail: `${number.format(tokens.cacheRead)} из ${number.format(prompt)}, записано ${number.format(tokens.cacheWrite)}, без кэша ${number.format(tokens.input)}`,
  };
}
/** The price is in the provider's own currency, so only the figure is shown. */
const money = (value: number) =>
  new Intl.NumberFormat("ru", { maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
const chatLine = computed(() => {
  const chat = props.chat;
  if (!chat) return "";
  const tokens = `Весь чат: ${number.format(chat.tokens)} токенов`;
  return chat.priced ? `${tokens}, стоимость ${money(chat.cost)}` : tokens;
});
const rows = computed(() => [
  ...(props.usage.first ? [cacheRow("Первый запрос", props.usage.first)] : []),
  cacheRow("Весь ответ", props.usage),
]);
</script>

<template>
  <UiTooltip>
    <template #default="{ describedby }">
      <UiButton shape="icon" size="sm" aria-label="Токены и кэш" :aria-describedby="describedby">
        <IconInfo aria-hidden="true" />
      </UiButton>
    </template>
    <template #content>
      <span v-for="row in rows" :key="row.label" class="usage-row">
        <span class="usage-label">{{ row.label }}</span>
        <span class="usage-value">{{ row.value }}</span>
        <span class="usage-detail">{{ row.detail }}</span>
      </span>
      <span class="usage-detail usage-line"
        >Выведено токенов: {{ number.format(usage.output) }}</span
      >
      <span v-if="usage.cost !== undefined" class="usage-detail usage-line">
        Стоимость ответа: {{ money(usage.cost) }}
      </span>
      <span v-if="chat" class="usage-detail usage-line">{{ chatLine }}</span>
    </template>
  </UiTooltip>
</template>

<style scoped>
.usage-row {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: var(--sp-4);
  margin-bottom: var(--sp-2);
}
.usage-label,
.usage-detail {
  color: var(--muted);
}
.usage-line {
  display: block;
}
.usage-detail {
  grid-column: 1 / -1;
  font-variant-numeric: tabular-nums;
}
</style>
