<script setup lang="ts">
import UiIslandFooter from "../../../common/ui/UiIslandFooter.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import UiIslandHeader from "../../../common/ui/UiIslandHeader.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import UiActionRow from "../../../common/ui/UiActionRow.vue";
import UiActionCopy from "../../../common/ui/UiActionCopy.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { computed, useId } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import {
  AgentUsageIndicators,
  agentUsageSummary,
  providerBalanceSummary,
} from "../../agents-integration/status-bar/index.ts";
import { useCompactViewport } from "../../../common/utilities/compact-viewport.ts";
import IconPlus from "~icons/lucide/plus";
import IconBot from "~icons/lucide/bot";
import IconMessage from "~icons/lucide/message-square";
import IconTerminal from "~icons/lucide/terminal";
import IconCodex from "~icons/simple-icons/openai";
import IconClaude from "~icons/simple-icons/claude";
import { guiPrograms, useAgentModes } from "../../agent/index.ts";
import IconOpenCode from "~icons/simple-icons/opencode";
import IconCursor from "~icons/simple-icons/cursor";

/**
 * «+» с островом создания сессии: при открытии рамка охватывает кнопку, как у переключателя
 * проекта. Остров рисуется поверх дока (Teleport), поэтому кнопка дублируется в его шапке.
 */
const props = defineProps<{ busy: boolean; agent?: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const programs = [
  {
    program: "shell",
    title: "Shell",
    caption: "Пустой терминал в папке проекта",
    icon: IconTerminal,
  },
  { program: "codex", title: "Codex", caption: "Запустит агента OpenAI Codex", icon: IconCodex },
  {
    program: "claude",
    title: "Claude Code",
    caption: "Запустит агента Anthropic",
    icon: IconClaude,
  },
  {
    program: "opencode",
    title: "OpenCode",
    caption: "Запустит агента OpenCode",
    icon: IconOpenCode,
  },
  { program: "cursor", title: "Cursor", caption: "Запустит агента Cursor", icon: IconCursor },
];
const menu = useIslandMenu({
  anchor: "left",
  initialFocus: ".row:not(:disabled)",
  items: ".row",
  closeOnTab: true,
});
const { open, toggle, close, active } = menu;
const listId = useId();
const rows = computed(() =>
  programs
    .filter((entry) => entry.program === "shell" || isEnabled(entry.program))
    .map((entry) => {
      const usage = agentUsageSummary[entry.program];
      return { ...entry, usage: usage?.remaining == null ? undefined : usage };
    }),
);

/** The status bar is hidden on mobile, so the limits shown below are polled only while this menu is open. */
const compact = useCompactViewport();

const { modeOf, setMode, isEnabled } = useAgentModes();
/** The chat view needs the agent feature; without it the terminal is the only option. */
const hasGui = (program: string) => props.agent && !!guiPrograms[program];
const toggleMode = (program: string) => setMode(program, modeOf(program) === "gui" ? "tui" : "gui");
function openChat() {
  close();
  emit("command", "ide.workbench.agent.open");
}
function pick(program: string) {
  if (props.busy) return;
  close();
  if (hasGui(program) && modeOf(program) === "gui") emit("command", guiPrograms[program]!.command);
  else emit("command", "ide.workbench.terminal.new", { program });
}
function hintTone(tone: "spare" | "normal" | "hot" | "over" | null | undefined) {
  return tone === "spare"
    ? "info"
    : tone === "hot"
      ? "warning"
      : tone === "over"
        ? "danger"
        : "neutral";
}
</script>

<template>
  <span v-if="compact && open" hidden><AgentUsageIndicators /></span>
  <span :ref="menu.trigger" class="new-session">
    <UiButton
      shape="icon"
      size="sm"
      title="Новая сессия"
      aria-label="Новая сессия"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menu.id : undefined"
      @click="toggle()"
    >
      <IconPlus aria-hidden="true" />
    </UiButton>
  </span>
  <UiIsland :menu="menu" label="Новая сессия">
    <UiIslandHeader anchor="start" class="island-head" aria-label="Закрыть" @click="toggle(false)">
      <IconPlus aria-hidden="true" /><span>Новая сессия</span>
    </UiIslandHeader>
    <UiStack flow="flex" gap="none" :id="listId" class="list" role="menu">
      <div v-for="(row, index) in rows" :key="row.program" class="entry">
        <UiActionRow
          class="row"
          role="menuitem"
          :disabled="busy"
          :tabindex="index === active ? 0 : -1"
          :data-command="
            hasGui(row.program) && modeOf(row.program) === 'gui'
              ? guiPrograms[row.program]!.command
              : 'ide.workbench.terminal.new'
          "
          @mousemove="active = index"
          @click="pick(row.program)"
        >
          <component :is="row.icon" class="row-icon" aria-hidden="true" />
          <UiActionCopy
            :title="row.title"
            :description="
              hasGui(row.program) && modeOf(row.program) === 'gui'
                ? 'Графический чат вместо терминала'
                : row.caption
            "
          />
          <UiBadge v-if="row.usage" class="hint" mono :tone="hintTone(row.usage.tone)"
            >{{ row.usage.remaining }}%</UiBadge
          >
        </UiActionRow>
        <button
          v-if="hasGui(row.program)"
          type="button"
          class="mode"
          :aria-pressed="modeOf(row.program) === 'gui'"
          :aria-label="`${row.title}: ${modeOf(row.program) === 'gui' ? 'графический чат' : 'терминал'}. Переключить режим`"
          :title="
            modeOf(row.program) === 'gui'
              ? 'Графический чат — нажмите, чтобы вернуть терминал'
              : 'Терминал — нажмите, чтобы открывать графический чат'
          "
          @click="toggleMode(row.program)"
        >
          <IconMessage v-if="modeOf(row.program) === 'gui'" aria-hidden="true" />
          <IconTerminal v-else aria-hidden="true" />
        </button>
      </div>
    </UiStack>
    <template v-if="agent">
      <UiIslandLabel divided>Projector</UiIslandLabel>
      <UiActionRow
        class="row"
        role="menuitem"
        data-command="ide.workbench.agent.open"
        :tabindex="active === programs.length ? 0 : -1"
        @mousemove="active = programs.length"
        @click="openChat"
      >
        <IconBot class="row-icon" aria-hidden="true" />
        <UiActionCopy
          title="Чат с агентом"
          description="Встроенный агент Projector, история разговоров"
        />
        <UiBadge
          v-if="providerBalanceSummary.text"
          class="hint"
          mono
          :tone="hintTone(providerBalanceSummary.tone)"
          >{{ providerBalanceSummary.text }}</UiBadge
        >
      </UiActionRow>
    </template>
    <UiIslandFooter hide-on-compact
      >↑↓ выбрать · Enter запустить сессию в папке проекта</UiIslandFooter
    >
  </UiIsland>
</template>

<style scoped>
.new-session {
  display: inline-flex;
  align-self: center;
  flex-shrink: 0;
  margin-inline: var(--sp-2) 0;
}
.entry {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.entry .row {
  flex: 1;
  min-width: 0;
  width: auto;
}
.mode {
  display: inline-flex;
  flex-shrink: 0;
  padding: 3px 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
}
.mode svg {
  width: 13px;
  height: 13px;
}
.mode:hover,
.mode:focus-visible {
  color: var(--text);
  border-color: var(--line-strong);
}
.mode[aria-pressed="true"] {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 55%, var(--line));
}
.row-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
