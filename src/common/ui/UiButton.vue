<script setup lang="ts">
defineProps<{
  variant?: "ghost" | "solid" | "danger" | "chip";
  active?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}>();
</script>

<template>
  <button
    class="btn"
    :class="[variant ?? 'ghost', { active, disabled }]"
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
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 6px 10px;
  color: var(--text);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.btn:hover:not(:disabled) {
  border-color: #4a4a44;
}

.solid {
  background: var(--text);
  color: var(--bg);
  border-color: var(--text);
}

.danger {
  color: var(--err);
}

.chip {
  padding: 3px 8px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}

.chip.active {
  color: var(--text);
  border-color: var(--text);
}

.disabled,
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
