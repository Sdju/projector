<script setup lang="ts">
import { computed } from "vue";
import UiSpinner from "./UiSpinner.vue";

const props = withDefaults(
  defineProps<{
    appearance?: "outline" | "solid" | "quiet";
    tone?: "neutral" | "muted" | "danger";
    shape?: "rect" | "icon" | "chip" | "pill";
    size?: "sm" | "md";
    busy?: boolean;
    active?: boolean;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { shape: "rect", size: "md", busy: undefined, type: "button" },
);
const appearance = computed(
  () => props.appearance ?? (props.shape === "icon" ? "quiet" : "outline"),
);
const tone = computed(
  () => props.tone ?? (["icon", "chip"].includes(props.shape) ? "muted" : "neutral"),
);
</script>

<template>
  <button
    class="btn"
    :class="[appearance, tone, shape, size, { active, 'busy-capable': busy !== undefined }]"
    :aria-busy="busy || undefined"
    :disabled="disabled || busy"
    :type="type"
  >
    <span v-if="busy !== undefined" class="button-content" :class="{ pending: busy }"
      ><slot
    /></span>
    <slot v-else />
    <UiSpinner v-if="busy" independent class="button-spinner" />
  </button>
</template>

<style scoped>
.btn {
  --button-color: var(--text);
  --button-fill: var(--text);
  --button-fill-hover: var(--text-2);
  --button-fill-down: var(--muted);
  --button-border-hover: var(--line-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--control-h);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 0 var(--sp-3);
  color: var(--button-color);
  font-size: var(--fs-xs);
  white-space: nowrap;
  transition:
    border-color var(--t-fast),
    background var(--t-fast),
    color var(--t-fast);
}
.muted {
  --button-color: var(--muted);
  --button-fill: var(--bg-3);
  --button-fill-hover: var(--bg-4);
  --button-fill-down: var(--line);
}
.danger {
  --button-color: var(--err);
  --button-fill: var(--err);
  --button-fill-hover: color-mix(in srgb, var(--err) 85%, var(--text));
  --button-fill-down: color-mix(in srgb, var(--err) 85%, var(--bg));
  --button-border-hover: var(--err);
}
.btn:hover:not(:disabled) {
  border-color: var(--button-border-hover);
  background: var(--hover);
  color: var(--text);
}
.danger:hover:not(:disabled) {
  color: var(--err);
}
.btn:active:not(:disabled) {
  background: var(--active);
}
.btn.sm {
  min-height: var(--control-h-sm);
  padding: 0 10px;
}
.quiet,
.quiet:hover:not(:disabled) {
  border-color: transparent;
}
.btn.solid {
  background: var(--button-fill);
  border-color: var(--button-fill);
  color: var(--bg);
}
.btn.solid:hover:not(:disabled) {
  background: var(--button-fill-hover);
  border-color: var(--button-fill-hover);
  color: var(--bg);
}
.btn.solid:active:not(:disabled) {
  background: var(--button-fill-down);
}
.btn.solid.muted {
  color: var(--muted);
}
.btn.solid.muted:hover:not(:disabled) {
  color: var(--text);
}
.btn.icon {
  width: var(--control-h);
  padding: 0;
}
.btn.icon.sm {
  width: var(--control-h-sm);
}
.icon.active {
  background: var(--hover);
  color: var(--text);
}
.icon :slotted(svg) {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
}
.btn.chip {
  min-height: 0;
  padding: 3px var(--sp-2);
  font-family: var(--mono);
}
.chip.active {
  color: var(--text);
  border-color: var(--text);
}
.btn.pill {
  min-height: 0;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-full);
  white-space: normal;
}
.outline.pill {
  transition:
    border-color var(--t-fast),
    color var(--t-fast);
}
.outline.pill:hover:not(:disabled),
.outline.pill:active:not(:disabled) {
  background: transparent;
}
.btn:disabled {
  opacity: 0.45;
}
.solid:disabled {
  background: transparent;
  color: var(--muted);
  border-color: var(--line);
}
.busy-capable {
  position: relative;
}
.button-content {
  display: inline-flex;
  align-items: inherit;
  justify-content: inherit;
  gap: inherit;
}
.button-content.pending {
  opacity: 0;
}
.button-spinner {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .btn.chip {
    min-height: var(--control-h-sm);
  }
}
</style>
