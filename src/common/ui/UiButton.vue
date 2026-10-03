<script setup lang="ts">
defineProps<{
  variant?: "ghost" | "solid" | "danger" | "chip";
  size?: "sm" | "md";
  /** Квадратная кнопка с одной иконкой; подпись задаётся через aria-label. */
  icon?: boolean;
  active?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}>();
</script>

<template>
  <button
    class="btn"
    :class="[variant ?? 'ghost', size ?? 'md', { icon, active, disabled }]"
    :disabled="disabled"
    :type="type ?? 'button'"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--control-h);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 0 var(--sp-3);
  color: var(--text);
  font-size: var(--fs-xs);
  white-space: nowrap;
  transition:
    border-color var(--t-fast),
    background var(--t-fast),
    color var(--t-fast);
}

.btn.sm {
  min-height: var(--control-h-sm);
  padding: 0 10px;
}

.btn:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--hover);
}

.btn:active:not(:disabled) {
  background: var(--active);
}

.solid {
  background: var(--text);
  color: var(--bg);
  border-color: var(--text);
}

.solid:hover:not(:disabled) {
  background: var(--text-2);
  border-color: var(--text-2);
}

.solid:active:not(:disabled) {
  background: var(--muted);
}

.danger {
  color: var(--err);
}

.danger:hover:not(:disabled) {
  border-color: var(--err);
}

.chip {
  min-height: 0;
  padding: 3px var(--sp-2);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--muted);
}

.chip:hover:not(:disabled) {
  color: var(--text);
}

.chip.active {
  color: var(--text);
  border-color: var(--text);
}

/* Иконочная кнопка: без рамки, квадрат по высоте контрола */
.btn.icon {
  width: var(--control-h);
  padding: 0;
  border-color: transparent;
  color: var(--muted);
}

.icon.danger {
  color: var(--err);
}

.btn.icon.sm {
  width: var(--control-h-sm);
}

.icon:hover:not(:disabled) {
  border-color: transparent;
  color: var(--text);
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

.disabled,
.btn:disabled {
  opacity: 0.45;
}

.solid:disabled {
  background: transparent;
  color: var(--muted);
  border-color: var(--line);
}
</style>
