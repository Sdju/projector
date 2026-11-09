<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  items: { label: string; value: number; share: number }[];
  center?: string;
  format?: (value: number) => string;
}>();

const colors = [
  "var(--info)",
  "var(--run)",
  "var(--warn)",
  "var(--err)",
  "var(--faint)",
  "var(--muted)",
];
const R = 42;
const C = 2 * Math.PI * R;
const total = computed(() => props.items.reduce((sum, item) => sum + item.value, 0) || 1);
const arcs = computed(() => {
  let offset = 0;
  return props.items.map((item, index) => {
    const length = (item.value / total.value) * C;
    const arc = {
      ...item,
      color: colors[index % colors.length],
      dash: `${length} ${C - length}`,
      offset: -offset,
    };
    offset += length;
    return arc;
  });
});
const format = (value: number) => props.format?.(value) ?? String(value);
const share = (value: number) => `${Math.round(value * 100)}%`;
</script>

<template>
  <div class="donut">
    <div class="ring">
      <svg viewBox="0 0 100 100" role="img" aria-label="Доля токенов по агентам">
        <circle
          v-for="arc in arcs"
          :key="arc.label"
          cx="50"
          cy="50"
          :r="R"
          fill="none"
          :stroke="arc.color"
          stroke-width="13"
          :stroke-dasharray="arc.dash"
          :stroke-dashoffset="arc.offset"
          transform="rotate(-90 50 50)"
        >
          <title>{{ arc.label }}: {{ share(arc.share) }}</title>
        </circle>
        <text x="50" y="54" text-anchor="middle" class="center">{{ center ?? format(total) }}</text>
      </svg>
    </div>
    <ul>
      <li v-for="arc in arcs" :key="arc.label">
        <i :style="{ background: arc.color }" />
        <span class="label">{{ arc.label }}</span>
        <span class="value">{{ format(arc.value) }}</span>
        <span class="share">{{ share(arc.share) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: center;
  gap: var(--sp-4);
}
.ring {
  width: 132px;
  height: 132px;
}
svg {
  display: block;
  width: 100%;
  height: 100%;
}
.center {
  fill: var(--text);
  font-size: 13px;
  font-weight: 600;
}
ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  min-width: 0;
  list-style: none;
  font-size: var(--fs-2xs);
}
li {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto 36px;
  align-items: center;
  gap: 6px;
}
li i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.label {
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.share {
  color: var(--muted);
  text-align: end;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 420px) {
  .donut {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
  }
}
</style>
