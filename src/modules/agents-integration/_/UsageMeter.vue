<script setup lang="ts">
// Adapters own window selection and commands; this component only renders the meter.
defineProps<{
  remaining: number | null;
  ariaLabel?: string;
  prefix?: string;
  countdown?: string;
  ticks?: readonly number[];
  exhausted?: boolean;
  compact?: boolean;
}>();
</script>

<template>
  <span
    class="quota-bar"
    :class="{ unavailable: remaining === null, exhausted, compact, 'tooltip-bar': countdown !== undefined }"
    :role="ariaLabel && remaining !== null ? 'meter' : undefined"
    :aria-valuemin="ariaLabel && remaining !== null ? 0 : undefined"
    :aria-valuemax="ariaLabel && remaining !== null ? 100 : undefined"
    :aria-valuenow="ariaLabel ? remaining ?? undefined : undefined"
    :aria-label="ariaLabel"
  >
    <span v-if="remaining !== null" class="quota-fill" :style="{ width: `${remaining}%` }" />
    <span
      v-for="position in ticks"
      :key="position"
      class="quota-tick"
      :style="{ left: `${position}%` }"
      aria-hidden="true"
    />
    <span class="quota-label">
      <span>{{ prefix ? `${prefix} · ` : "" }}{{ remaining === null ? "—" : `${remaining}%` }}</span>
      <span v-if="countdown !== undefined" class="quota-time">{{ countdown }}</span>
    </span>
  </span>
</template>

<style scoped>
.quota-bar {
  position: relative;
  min-width: 84px;
  height: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg-sunken);
}
.compact { min-width: 64px; }
.quota-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, currentColor 22%, transparent);
}
.quota-label {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding-inline: 6px;
  white-space: nowrap;
  color: var(--text);
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.quota-time { opacity: 0.7; }
.quota-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, currentColor 25%, transparent);
  pointer-events: none;
}
.tooltip-bar { height: 18px; }
.tooltip-bar .quota-label { justify-content: space-between; }
.exhausted { border-color: var(--muted); }
.unavailable .quota-label { color: var(--muted); }
</style>
