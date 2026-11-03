<script setup lang="ts">
import { computed } from "vue";
import { icons } from "../../_/index.ts";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

interface Chip {
  label: string;
  tone?: Tone;
  icon?: string;
}

const props = defineProps<{
  items: (string | Chip)[];
  mono?: boolean;
}>();

const palette: Tone[] = ["info", "accent", "success", "warning"];
const chips = computed(() =>
  props.items.map((item, index) => {
    const chip = typeof item === "string" ? { label: item } : item;
    return {
      ...chip,
      tone: chip.tone ?? palette[index % palette.length],
      icon: chip.icon ? icons[chip.icon] : undefined,
    };
  }),
);
</script>

<template>
  <div class="chips">
    <span
      v-for="(chip, index) in chips"
      :key="`${index}:${chip.label}`"
      class="chip"
      :class="[chip.tone, { mono }]"
    >
      <component :is="chip.icon" v-if="chip.icon" class="icon" aria-hidden="true" />
      <span v-else class="dot" aria-hidden="true" />
      {{ chip.label }}
    </span>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
  align-items: center;
}
.chip {
  --chip-color: var(--muted);
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 2px 9px 2px 7px;
  border: 1px solid color-mix(in srgb, var(--chip-color) 42%, var(--line));
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-color) 12%, var(--bg-2));
  color: color-mix(in srgb, var(--chip-color) 58%, var(--text));
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--chip-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chip-color) 15%, transparent);
}
.icon {
  width: 11px;
  height: 11px;
  stroke-width: 2;
}
.neutral {
  --chip-color: var(--muted);
}
.info {
  --chip-color: var(--info);
}
.success {
  --chip-color: var(--run);
}
.warning {
  --chip-color: var(--warn);
}
.danger {
  --chip-color: var(--err);
}
.accent {
  --chip-color: var(--accent);
}
.mono {
  font-family: var(--mono);
}
</style>
