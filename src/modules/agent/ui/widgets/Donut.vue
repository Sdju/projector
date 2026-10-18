<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ items: { label: string; value: number }[]; center?: string }>();
const colors = ["var(--info)", "var(--run)", "var(--warn)", "var(--err)", "var(--faint)"];
const R = 40;
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
</script>

<template>
  <div class="donut">
    <svg viewBox="0 0 100 100" role="img">
      <circle
        v-for="arc in arcs"
        :key="arc.label"
        cx="50"
        cy="50"
        :r="R"
        fill="none"
        :stroke="arc.color"
        stroke-width="14"
        :stroke-dasharray="arc.dash"
        :stroke-dashoffset="arc.offset"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="54" text-anchor="middle" class="center">{{ center ?? total }}</text>
    </svg>
    <ul>
      <li v-for="arc in arcs" :key="arc.label">
        <i :style="{ background: arc.color }" />{{ arc.label }}
        <span>{{ arc.share }}%</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}
svg {
  width: 120px;
  flex: none;
}
.center {
  fill: var(--text);
  font-size: 10px;
  font-weight: 600;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-xs);
  display: grid;
  gap: 4px;
}
i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}
span {
  color: var(--muted);
  margin-left: 6px;
}
</style>
