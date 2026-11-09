<script setup lang="ts">
import { computed } from "vue";

type MeterTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const props = withDefaults(
  defineProps<{
    /** Filled part in percent, 0–100. */
    value?: number;
    tone?: MeterTone;
    height?: number;
    /** Mix the colour with the line colour instead of using it solid. */
    soft?: boolean;
    /** Two or more parts instead of one; their values are percentages too. */
    segments?: Array<{ value: number; tone: MeterTone; soft?: boolean }>;
    ariaLabel?: string;
  }>(),
  { value: 0, tone: "neutral", height: 6, soft: false },
);
const clamp = (value: number) => `${Math.max(0, Math.min(100, value))}%`;
const parts = computed(() =>
  props.segments?.length
    ? props.segments.map((segment) => ({ ...segment, width: clamp(segment.value) }))
    : [{ tone: props.tone, soft: props.soft, width: clamp(props.value) }],
);
</script>

<template>
  <div
    class="meter"
    :style="{ height: `${height}px` }"
    role="meter"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value"
    :aria-label="ariaLabel"
  >
    <i
      v-for="(part, index) in parts"
      :key="index"
      :class="[part.tone, { soft: part.soft }]"
      :style="{ width: part.width }"
    />
  </div>
</template>

<style scoped>
.meter {
  overflow: hidden;
  border-radius: 3px;
  background: var(--bg-sunken);
}
.meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width var(--t-fast);
}
.neutral {
  background: color-mix(in srgb, currentColor 55%, var(--line));
}
.info {
  background: var(--info);
}
.success {
  background: var(--run);
}
.warning {
  background: var(--warn);
}
.danger {
  background: var(--err);
}
.accent {
  background: var(--accent);
}
.soft.info {
  background: color-mix(in srgb, var(--info) 72%, var(--line));
}
.soft.success {
  background: color-mix(in srgb, var(--run) 72%, var(--line));
}
.soft.warning {
  background: color-mix(in srgb, var(--warn) 72%, var(--line));
}
.soft.danger {
  background: color-mix(in srgb, var(--err) 72%, var(--line));
}
.soft.accent {
  background: color-mix(in srgb, var(--accent) 72%, var(--line));
}
</style>
