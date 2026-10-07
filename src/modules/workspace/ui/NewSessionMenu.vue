<script setup lang="ts">
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { computed, useId } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { agentUsageSummary } from "../../agents-integration/status-bar/index.ts";
import IconPlus from "~icons/lucide/plus";
import IconBot from "~icons/lucide/bot";
import IconTerminal from "~icons/lucide/terminal";
import IconCodex from "~icons/simple-icons/openai";
import IconClaude from "~icons/simple-icons/claude";
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
  programs.map((entry) => {
    const usage = agentUsageSummary[entry.program];
    return { ...entry, usage: usage?.remaining == null ? undefined : usage };
  }),
);

function openChat() {
  close();
  emit("command", "ide.workbench.agent.open");
}
function pick(program: string) {
  if (props.busy) return;
  close();
  emit("command", "ide.workbench.terminal.new", { program });
}
</script>

<template>
  <span :ref="menu.trigger" class="new-session">
    <UiButton
      icon
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
    <button class="island-head" aria-label="Закрыть" @click="toggle(false)">
      <IconPlus aria-hidden="true" /><span>Новая сессия</span>
    </button>
    <div :id="listId" class="list" role="menu">
      <button
        v-for="(row, index) in rows"
        :key="row.program"
        class="row"
        role="menuitem"
        :disabled="busy"
        :tabindex="index === active ? 0 : -1"
        data-command="ide.workbench.terminal.new"
        @mousemove="active = index"
        @click="pick(row.program)"
      >
        <component :is="row.icon" class="row-icon" aria-hidden="true" />
        <span class="copy">
          <span class="name">{{ row.title }}</span>
          <span class="caption">{{ row.caption }}</span>
        </span>
        <span v-if="row.usage" class="hint" :class="row.usage.tone && `tone-${row.usage.tone}`"
          >{{ row.usage.remaining }}%</span
        >
      </button>
    </div>
    <template v-if="agent">
      <div class="group-title">Projector</div>
      <button
        class="row"
        role="menuitem"
        data-command="ide.workbench.agent.open"
        :tabindex="active === programs.length ? 0 : -1"
        @mousemove="active = programs.length"
        @click="openChat"
      >
        <IconBot class="row-icon" aria-hidden="true" />
        <span class="copy">
          <span class="name">Чат с агентом</span>
          <span class="caption">Встроенный агент Projector, история разговоров</span>
        </span>
      </button>
    </template>
    <footer class="foot">↑↓ выбрать · Enter запустить сессию в папке проекта</footer>
  </UiIsland>
</template>

<style scoped>
.new-session {
  display: inline-flex;
  align-self: center;
  flex-shrink: 0;
  margin-inline: var(--sp-2) 0;
}
/* Шапка стоит ровно на месте кнопки, поэтому остров выглядит продолжением вкладок */
.island-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: var(--control-h-sm);
  padding-inline: 7px var(--sp-2);
  border-radius: var(--r-md);
  color: var(--text);
}
.island-head svg {
  width: 14px;
  height: 14px;
}
.list {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding: 6px var(--sp-2);
  border-radius: var(--r-md);
  text-align: left;
}
.row:hover:not(:disabled),
.row:focus-visible {
  background: var(--active);
  outline: none;
}
.row:disabled {
  opacity: 0.45;
}
.row-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: var(--fs-sm);
}
.caption {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.hint {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  font-variant-numeric: tabular-nums;
}
.hint.tone-spare {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 55%, var(--line));
}
.hint.tone-hot {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 55%, var(--line));
}
.hint.tone-over {
  color: var(--err);
  border-color: color-mix(in srgb, var(--err) 55%, var(--line));
}
.group-title {
  margin-top: var(--sp-1);
  padding: var(--sp-2) var(--sp-2) 2px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
.foot {
  padding: var(--sp-1) var(--sp-2) 2px;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
