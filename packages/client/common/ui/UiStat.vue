<script setup lang="ts">
/** One labelled figure: the widget `Stat`, analytics totals and day cards share its geometry. */
withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    delta?: number;
    hint?: string;
    size?: "md" | "lg";
    /** Draw the bordered figure cell used by analytics day cards. */
    frame?: boolean;
  }>(),
  { size: "md", frame: false },
);
</script>

<template>
  <div class="ui-stat" :class="[size, { frame }]">
    <span class="label">{{ label }}</span>
    <strong class="value">{{ value }}</strong>
    <span v-if="delta !== undefined" class="delta" :class="delta >= 0 ? 'up' : 'down'">
      {{ delta >= 0 ? "▲" : "▼" }} {{ Math.abs(delta) }}%
    </span>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.ui-stat {
  display: grid;
  gap: 2px;
  align-content: start;
  min-width: 8em;
}
.label,
.hint {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.value {
  color: var(--text);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.lg .value {
  font-size: var(--fs-lg);
}
.delta {
  font-size: var(--fs-2xs);
}
.up {
  color: var(--run);
}
.down {
  color: var(--err);
}
.frame {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
</style>
