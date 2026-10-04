<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import IconCodex from "~icons/simple-icons/openai";
import type { CodexUsage } from "../../../../core/modules/codex/index.ts";

const usage = ref<CodexUsage | null>(null);
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let disposed = false;

async function refresh() {
  if (disposed || controller || document.hidden) return;
  clearTimeout(timer);
  controller = new AbortController();
  try {
    const response = await fetch("/api/codex/usage", { signal: controller.signal });
    if (!response.ok) throw new Error("Codex usage unavailable");
    usage.value = await response.json();
    failed.value = false;
  } catch {
    if (!disposed) failed.value = true;
  } finally {
    controller = undefined;
    if (!disposed) timer = setTimeout(refresh, 60000);
  }
}
const remaining = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !usage.value.weekly) return null;
  return Math.round(100 - usage.value.weekly.usedPercent);
});
const tooltip = computed(() => {
  if (failed.value) return "Codex: не удалось обновить недельный лимит";
  if (!usage.value) return "Codex: загрузка недельного лимита…";
  if (remaining.value === null) return `Codex: ${usage.value.message ?? "лимит недоступен"}`;
  const reset = usage.value.weekly?.resetsAt;
  const resetTime = reset
    ? new Date(reset * 1000).toLocaleString(undefined, {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "неизвестно";
  return `Codex · осталось ${remaining.value}% недельного лимита\nСброс: ${resetTime}`;
});
function visibilityChanged() {
  if (!document.hidden) void refresh();
}
onMounted(() => {
  void refresh();
  document.addEventListener("visibilitychange", visibilityChanged);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  controller?.abort();
  document.removeEventListener("visibilitychange", visibilityChanged);
});
</script>

<template>
  <span class="codex-usage" :title="tooltip" :aria-label="tooltip" tabindex="0">
    <IconCodex class="codex-icon" aria-hidden="true" />
    <span
      class="quota-bar"
      :class="{ unavailable: remaining === null }"
      :role="remaining === null ? undefined : 'meter'"
      :aria-valuemin="remaining === null ? undefined : 0"
      :aria-valuemax="remaining === null ? undefined : 100"
      :aria-valuenow="remaining ?? undefined"
      aria-label="Остаток недельного лимита Codex"
    >
      <span v-if="remaining !== null" class="quota-fill" :style="{ width: `${remaining}%` }" />
      <span class="quota-label">{{ remaining === null ? "—" : `${remaining}%` }}</span>
    </span>
    <span class="quota-tooltip" role="tooltip">{{ tooltip }}</span>
  </span>
</template>

<style scoped>
.codex-usage {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  outline-offset: 2px;
}
.codex-icon {
  width: 13px;
  height: 13px;
}
.quota-bar {
  position: relative;
  width: 64px;
  height: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg-sunken);
}
.quota-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, currentColor 22%, transparent);
}
.quota-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text);
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.unavailable .quota-label {
  color: var(--muted);
}
.quota-tooltip {
  position: absolute;
  z-index: 30;
  right: 0;
  bottom: calc(100% + 7px);
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg-raised, var(--bg));
  color: var(--text);
  white-space: pre-line;
  width: max-content;
  max-width: min(340px, 80vw);
  box-shadow: 0 3px 12px #0002;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.codex-usage:hover .quota-tooltip,
.codex-usage:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
