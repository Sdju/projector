<script setup lang="ts">
defineProps<{ label: string; value: string | number; delta?: number; hint?: string }>();
</script>

<template>
  <div class="stat">
    <span class="label">{{ label }}</span>
    <strong class="value">{{ value }}</strong>
    <span v-if="delta !== undefined" class="delta" :class="delta >= 0 ? 'up' : 'down'">
      {{ delta >= 0 ? "▲" : "▼" }} {{ Math.abs(delta) }}%
    </span>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.stat {
  display: grid;
  gap: 2px;
  min-width: 8em;
}
.label,
.hint {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.value {
  color: var(--text);
  font-size: var(--fs-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
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
</style>
