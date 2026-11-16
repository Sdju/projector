<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  items: { label: string; value: number }[];
  center?: string;
  format?: (value: number) => string;
  /** Show the absolute value next to the share in the legend. */
  showValues?: boolean;
  ariaLabel?: string;
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
      share: Math.round((item.value / total.value) * 100),
    };
    offset += length;
    return arc;
  });
});
const format = (value: number) => props.format?.(value) ?? String(value);
</script>

<template>
  <div class="donut">
    <div class="layout">
      <div class="ring">
        <svg viewBox="0 0 100 100" role="img" :aria-label="ariaLabel">
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
            <title>{{ arc.label }}: {{ arc.share }}%</title>
          </circle>
          <text x="50" y="54" text-anchor="middle" class="center">
            {{ center ?? format(total) }}
          </text>
        </svg>
      </div>
      <ul :class="{ 'with-values': showValues }">
        <li v-for="arc in arcs" :key="arc.label">
          <i :style="{ background: arc.color }" />
          <span class="label" :title="arc.label">{{ arc.label }}</span>
          <span v-if="showValues" class="value">{{ format(arc.value) }}</span>
          <span class="share">{{ arc.share }}%</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.donut {
  container-type: inline-size;
}
.layout {
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
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}
.with-values li {
  grid-template-columns: 8px minmax(0, 1fr) auto auto;
}
li i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.label {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.value {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.share {
  color: var(--muted);
  min-width: 36px;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
@container (max-width: 440px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
  }
  ul {
    width: 100%;
  }
}
</style>
