<script setup lang="ts">
import { computed } from "vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import type { AgentContext } from "../model/types.ts";

const props = defineProps<{ context: AgentContext }>();

const menu = useIslandMenu({
  anchor: "right",
  placement: "above",
  initialFocus: "button",
  returnFocus: "button",
});
const { open } = menu;

const percent = computed(() =>
  Math.min(100, Math.max(0, (props.context.used / props.context.size) * 100)),
);
const tone = computed(() => (percent.value >= 90 ? "err" : percent.value >= 70 ? "warn" : "ok"));
const left = computed(() => Math.max(0, props.context.size - props.context.used));
const number = new Intl.NumberFormat("ru");
const tokens = (value: number) => number.format(Math.round(value));
const short = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(value);
const label = computed(
  () =>
    `Контекст заполнен на ${Math.round(percent.value)}%: ${short(props.context.used)} из ${short(props.context.size)}`,
);

const names: Record<string, string> = {
  "System prompt": "Системный промпт",
  "System tools": "Инструменты",
  "MCP tools": "MCP-инструменты",
  "Custom agents": "Агенты",
  "Memory files": "Файлы памяти",
  Skills: "Навыки",
  Messages: "Сообщения",
};
const categories = computed(() =>
  [...(props.context.categories ?? [])]
    .sort((a, b) => b.tokens - a.tokens)
    .map((item) => ({
      name: names[item.name] ?? item.name,
      tokens: item.tokens,
      share: (item.tokens / Math.max(1, props.context.used)) * 100,
    })),
);
const cost = computed(() => {
  const value = props.context.cost;
  if (!value) return "";
  try {
    return new Intl.NumberFormat("ru", { style: "currency", currency: value.currency }).format(
      value.amount,
    );
  } catch {
    return `${value.amount} ${value.currency}`;
  }
});

// The island is a hint: it follows the pointer and the keyboard focus, and a click pins nothing.
const show = () => void menu.toggle(true);
const hide = () => menu.close(false);
</script>

<template>
  <div :ref="menu.trigger" class="context-meter">
    <button
      type="button"
      class="ring-button"
      :class="tone"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="open ? menu.id : undefined"
      aria-haspopup="dialog"
      @mouseenter="show"
      @mouseleave="hide"
      @focus="show"
      @blur="hide"
      @keydown.esc="hide"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle class="track" cx="10" cy="10" r="7.5" pathLength="100" />
        <circle
          class="fill"
          cx="10"
          cy="10"
          r="7.5"
          pathLength="100"
          :stroke-dasharray="`${percent} 100`"
        />
      </svg>
    </button>
  </div>
  <UiIsland :menu="menu" label="Контекст агента" :width="280">
    <div class="details" :class="tone">
      <div class="headline">
        <span class="title">Контекст</span>
        <span class="percent">{{ Math.round(percent) }}%</span>
      </div>
      <div class="bar" aria-hidden="true">
        <span class="bar-fill" :style="{ width: `${percent}%` }" />
        <span
          v-if="context.compactAt"
          class="bar-mark"
          :style="{ left: `${(context.compactAt / context.size) * 100}%` }"
        />
      </div>
      <p class="line">{{ tokens(context.used) }} из {{ tokens(context.size) }} токенов</p>
      <p class="note">Свободно {{ tokens(left) }}</p>
      <ul v-if="categories.length" class="categories">
        <li v-for="item in categories" :key="item.name">
          <span class="cat-name u-truncate">{{ item.name }}</span>
          <span class="cat-bar" aria-hidden="true"
            ><span :style="{ width: `${Math.max(2, item.share)}%` }"
          /></span>
          <span class="cat-tokens">{{ short(item.tokens) }}</span>
        </li>
      </ul>
      <p v-if="context.compactAt" class="note">
        Автосжатие при {{ tokens(context.compactAt) }} токенов
      </p>
      <p v-if="context.model || cost" class="note">
        <span v-if="context.model">{{ context.model }}</span>
        <span v-if="context.model && cost"> · </span>
        <span v-if="cost">{{ cost }}</span>
      </p>
    </div>
  </UiIsland>
</template>

<style scoped>
.context-meter {
  display: flex;
}
.ring-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border-radius: var(--r-md);
  color: var(--run);
}
.ring-button.warn {
  color: var(--warn);
}
.ring-button.err {
  color: var(--err);
}
.ring-button:hover,
.ring-button[aria-expanded="true"] {
  background: var(--hover);
}
svg {
  width: 18px;
  height: 18px;
  transform: rotate(-90deg);
}
circle {
  fill: none;
  stroke-width: 2.5;
}
.track {
  stroke: var(--line-strong);
}
.fill {
  stroke: currentColor;
  stroke-linecap: round;
  transition: stroke-dasharray var(--t-fast);
}
.details {
  --tone: var(--run);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  color: var(--text-2);
}
.details.warn {
  --tone: var(--warn);
}
.details.err {
  --tone: var(--err);
}
.headline {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.title {
  color: var(--text);
}
.percent {
  color: var(--tone);
  font-variant-numeric: tabular-nums;
}
.bar {
  position: relative;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--bg-sunken);
}
.bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--tone);
}
.bar-mark {
  position: absolute;
  top: -2px;
  width: 1px;
  height: 8px;
  background: var(--muted);
}
.line,
.note {
  margin: 0;
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.muted,
.note {
  color: var(--muted);
}
.categories {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: var(--sp-1) 0 0;
  padding: var(--sp-2) 0 0;
  border-top: 1px solid var(--line);
  list-style: none;
  font-size: var(--fs-2xs);
}
.categories li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 56px 36px;
  align-items: center;
  gap: var(--sp-2);
}

.cat-bar {
  height: 3px;
  border-radius: var(--r-full);
  background: var(--bg-sunken);
  overflow: hidden;
}
.cat-bar span {
  display: block;
  height: 100%;
  background: var(--muted);
}
.cat-tokens {
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>
