<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { agentUsageSummary } from "../../agents-integration/status-bar/index.ts";
import IconPlus from "~icons/lucide/plus";
import IconTerminal from "~icons/lucide/terminal";
import IconCodex from "~icons/simple-icons/openai";
import IconClaude from "~icons/simple-icons/claude";
import IconOpenCode from "~icons/simple-icons/opencode";
import IconCursor from "~icons/simple-icons/cursor";

/** Кнопка «+» с меню создания терминальной сессии: shell или агент. */
const props = defineProps<{ busy: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const programs = [
  { program: "shell", title: "Новый shell", icon: IconTerminal },
  { program: "codex", title: "Новый Codex", icon: IconCodex },
  { program: "claude", title: "Новый Claude Code", icon: IconClaude },
  { program: "opencode", title: "Новый OpenCode", icon: IconOpenCode },
  { program: "cursor", title: "Новый Cursor", icon: IconCursor },
];
const menu = ref<InstanceType<typeof ContextMenu>>();
function usageHint(program: string): ContextMenuItem["hint"] {
  const usage = agentUsageSummary[program];
  return usage?.remaining == null
    ? undefined
    : { text: `${usage.remaining}%`, tone: usage.tone };
}
const items = computed<ContextMenuItem[]>(() =>
  programs.map((entry) => ({
    id: entry.program,
    label: entry.title,
    icon: entry.icon,
    disabled: props.busy,
    hint: usageHint(entry.program),
    command: "ide.workbench.terminal.new",
    run: () => emit("command", "ide.workbench.terminal.new", { program: entry.program }),
  })),
);
</script>

<template>
  <UiButton
    icon
    size="sm"
    class="new-session"
    title="Новая сессия"
    aria-label="Новая сессия"
    aria-haspopup="menu"
    @click="menu?.open($event)"
  >
    <IconPlus aria-hidden="true" />
  </UiButton>
  <ContextMenu ref="menu" :items="items" label="Новая сессия" />
</template>

<style scoped>
.new-session {
  align-self: center;
  flex-shrink: 0;
  margin-inline: var(--sp-2) 0;
}
</style>
