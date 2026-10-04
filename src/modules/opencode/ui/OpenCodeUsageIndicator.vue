<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, useId } from "vue";
import IconOpenCode from "~icons/simple-icons/opencode";
import type { OpenCodeUsage } from "../../../../core/modules/opencode/index.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";

const usage = ref<OpenCodeUsage | null>(null);
const failed = ref(false);
type WindowName = keyof NonNullable<OpenCodeUsage["windows"]>;
const windowOrder: WindowName[] = ["monthly", "rolling", "weekly"];
const labels = { rolling: "5 часов", weekly: "Неделя", monthly: "Месяц" };
const shortLabels = { rolling: "5ч", weekly: "нед", monthly: "мес" };
const selectedWindow = ref<WindowName>("weekly");
const commands = useCommandScope(`opencodeUsage:${useId()}`, () => ({
  surface: "statusBar", window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.opencode.usage.window.cycle",
  title: "Переключить отображаемый лимит OpenCode Go",
  description: "Меняет окно индикатора Go в статусной строке: месяц → 5 часов → неделя. Не запрашивает лимиты заново.",
  run: () => {
    selectedWindow.value = windowOrder[(windowOrder.indexOf(selectedWindow.value) + 1) % windowOrder.length]!;
    return { window: selectedWindow.value };
  },
});
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let disposed = false;

async function refresh() {
  if (disposed || controller || document.hidden) return;
  clearTimeout(timer);
  controller = new AbortController();
  try {
    const response = await fetch("/api/opencode/usage", { signal: controller.signal });
    if (!response.ok) throw new Error("OpenCode usage unavailable");
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
  if (failed.value || usage.value?.status !== "ready" || !usage.value.windows) return null;
  return Math.round(100 - usage.value.windows[selectedWindow.value].usedPercent);
});
const tooltip = computed(() => {
  const heading = `OpenCode Go · ${labels[selectedWindow.value]}\nНажмите, чтобы переключить лимит`;
  if (failed.value) return `${heading}\nНе удалось обновить лимиты`;
  if (!usage.value) return `${heading}\nЗагрузка лимитов…`;
  const windows = usage.value.windows;
  if (remaining.value === null || !windows)
    return `${heading}\n${usage.value.message ?? "Лимиты недоступны"}`;
  return [heading, ...Object.entries(labels).map(([name, label]) => {
    const window = windows[name as keyof typeof windows];
    const reset = window.resetsAt
      ? new Date(window.resetsAt * 1000).toLocaleString(undefined, {
        day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
      }) : "неизвестно";
    return `${label}: осталось ${Math.round(100 - window.usedPercent)}%${window.limited ? " · лимит исчерпан" : ""}\nСброс: ${reset}`;
  })].join("\n");
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
  <button
    type="button"
    class="opencode-usage"
    :aria-label="tooltip"
    @click="commands.run('ide.opencode.usage.window.cycle')"
  >
    <IconOpenCode class="opencode-icon" aria-hidden="true" />
    <span
      class="quota-bar"
      :class="{ unavailable: remaining === null }"
      :role="remaining === null ? undefined : 'meter'"
      :aria-valuemin="remaining === null ? undefined : 0"
      :aria-valuemax="remaining === null ? undefined : 100"
      :aria-valuenow="remaining ?? undefined"
      :aria-label="`Остаток лимита OpenCode Go: ${labels[selectedWindow]}`"
    >
      <span v-if="remaining !== null" class="quota-fill" :style="{ width: `${remaining}%` }" />
      <span class="quota-label">{{ shortLabels[selectedWindow] }} · {{ remaining === null ? "—" : `${remaining}%` }}</span>
    </span>
    <span class="quota-tooltip" role="tooltip">{{ tooltip }}</span>
  </button>
</template>

<style scoped>
.opencode-usage {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  outline-offset: 2px;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.opencode-icon {
  width: 13px;
  height: 13px;
}
.quota-bar {
  position: relative;
  width: 84px;
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
.unavailable .quota-label { color: var(--muted); }
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
  overflow-wrap: anywhere;
  width: max-content;
  max-width: min(340px, 80vw);
  box-shadow: 0 3px 12px #0002;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.opencode-usage:hover .quota-tooltip,
.opencode-usage:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
