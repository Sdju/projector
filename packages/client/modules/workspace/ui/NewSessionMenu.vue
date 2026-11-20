<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiIslandFooter from "../../../common/ui/UiIslandFooter.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import UiIslandHeader from "../../../common/ui/UiIslandHeader.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import UiActionRow from "../../../common/ui/UiActionRow.vue";
import UiActionCopy from "../../../common/ui/UiActionCopy.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { computed, useId, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import {
  AgentUsageIndicators,
  providerBalanceSummary,
} from "../../agents-integration/status-bar/index.ts";
import { useCompactViewport } from "../../../common/utilities/compact-viewport.ts";
import { loadChatRoles } from "../../agent-roles/index.ts";
import { clientAgentByBackend } from "../../agents-integration/catalog/index.ts";
import { useSessionLaunchers } from "../lib/session-launchers.ts";

/**
 * Запуск сессии: остров со списком Shell, агентов и ролей. Кнопка бывает двух видов:
 * «+» (в полосе вкладок группы терминалов) и split-кнопка (в шапке): основная часть
 * повторяет последний выбор, стрелка открывает остров. Остров рисуется поверх дока (Teleport),
 * поэтому кнопка дублируется в его шапке.
 */
const props = defineProps<{
  busy: boolean;
  agent?: boolean;
  projectId: string;
  variant?: "plus" | "split";
}>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const split = computed(() => props.variant === "split");
const launchers = useSessionLaunchers({
  agent: () => props.agent,
  busy: () => props.busy,
  command: (id, args) => emit("command", id, args),
});
const {
  rows,
  builtin,
  primary,
  modeOf,
  isEnabled,
  canOpenChat,
  commandOf,
  launchPrimary,
  toggleMode,
} = launchers;
const chatRoles = ref<Awaited<ReturnType<typeof loadChatRoles>>>([]);
const roleRows = computed(() =>
  chatRoles.value.flatMap((role) => {
    if (role.kind !== "chat") return [];
    const agent = clientAgentByBackend(role.agent);
    if (!agent || !isEnabled(agent.program)) return [];
    return [{ role, agent, title: role.name, caption: `${agent.title} · роль` }];
  }),
);
async function loadRoles() {
  try {
    // A project role is listed only when its file is trusted; global roles are always available.
    chatRoles.value = await loadChatRoles(props.projectId);
  } catch {
    chatRoles.value = [];
  }
}
const menu = useIslandMenu({
  anchor: split.value ? "right" : "left",
  initialFocus: ".row:not(:disabled)",
  items: ".row",
  closeOnTab: true,
});
const { open, toggle, close, active } = menu;
watch(open, (value) => {
  if (value) void loadRoles();
});
const listId = useId();

/** The status bar is hidden on mobile, so the limits shown below are polled only while this menu is open. */
const compact = useCompactViewport();

function openChat() {
  close();
  launchers.openBuiltin();
}
function pickRole(role: string) {
  if (props.busy) return;
  close();
  emit("command", "ide.agent.role.open", { role });
}
function editRole(role: string) {
  close();
  emit("command", "ide.agent.role.edit", { role });
}
function pick(program: string) {
  if (props.busy) return;
  close();
  launchers.launch(program);
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
  <span v-if="compact && open" hidden><AgentUsageIndicators :enabled="isEnabled" /></span>
  <span v-if="split" :ref="menu.trigger" class="split-session" :class="{ open }">
    <UiButton
      class="split-main"
      size="sm"
      :disabled="busy"
      :title="`Запустить: ${primary.title}`"
      :aria-label="`Запустить: ${primary.title}`"
      :data-command="primary.command"
      @click="launchPrimary"
    >
      <ProjectorIcon :name="primary.icon" class="split-icon" aria-hidden="true" />
      <span class="split-label">{{ primary.title }}</span>
    </UiButton>
    <UiButton
      class="split-more"
      size="sm"
      title="Новая сессия: выбрать Shell или агента"
      aria-label="Новая сессия: выбрать Shell или агента"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menu.id : undefined"
      @click="toggle()"
    >
      <ProjectorIcon name="chevron-down" class="split-icon" aria-hidden="true" />
    </UiButton>
  </span>
  <span v-else :ref="menu.trigger" class="new-session">
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
      <ProjectorIcon name="plus" aria-hidden="true" />
    </UiButton>
  </span>
  <UiIsland :menu="menu" label="Новая сессия">
    <UiIslandHeader
      :anchor="split ? 'end' : 'start'"
      class="island-head"
      aria-label="Закрыть"
      @click="toggle(false)"
    >
      <ProjectorIcon name="plus" aria-hidden="true" /><span>Новая сессия</span>
    </UiIslandHeader>
    <template v-if="roleRows.length">
      <UiIslandLabel divided>Роли</UiIslandLabel>
      <UiStack flow="flex" gap="none" class="list" role="menu" aria-label="Роли агентов">
        <div v-for="(row, index) in roleRows" :key="row.role.id" class="entry">
          <UiActionRow
            class="row"
            role="menuitem"
            :disabled="busy"
            :tabindex="index === active ? 0 : -1"
            data-command="ide.agent.role.open"
            @mousemove="active = index"
            @click="pickRole(row.role.id)"
          >
            <ProjectorIcon :name="row.agent.icon" class="row-icon" aria-hidden="true" />
            <UiActionCopy :title="row.title" :description="row.caption" />
          </UiActionRow>
          <button
            type="button"
            class="side"
            :aria-label="`Редактировать роль ${row.title}`"
            :title="`Редактировать роль «${row.title}»`"
            data-command="ide.agent.role.edit"
            @click="editRole(row.role.id)"
          >
            <ProjectorIcon name="settings-2" aria-hidden="true" />
          </button>
        </div>
      </UiStack>
      <UiIslandLabel>Агенты</UiIslandLabel>
    </template>
    <UiStack flow="flex" gap="none" :id="listId" class="list" role="menu">
      <div v-for="(row, index) in rows" :key="row.program" class="entry">
        <UiActionRow
          class="row"
          role="menuitem"
          :disabled="busy"
          :tabindex="roleRows.length + index === active ? 0 : -1"
          :data-command="commandOf(row.program)"
          @mousemove="active = roleRows.length + index"
          @click="pick(row.program)"
        >
          <ProjectorIcon :name="row.icon" class="row-icon" aria-hidden="true" />
          <UiActionCopy
            :title="row.title"
            :description="
              canOpenChat(row.program) && modeOf(row.program) === 'gui'
                ? 'Графический чат вместо терминала'
                : row.caption
            "
          />
          <UiBadge v-if="row.usage" class="hint" mono :tone="hintTone(row.usage.tone)"
            >{{ row.usage.remaining }}%</UiBadge
          >
        </UiActionRow>
        <button
          v-if="canOpenChat(row.program)"
          type="button"
          class="side mode"
          :aria-pressed="modeOf(row.program) === 'gui'"
          :aria-label="`${row.title}: ${modeOf(row.program) === 'gui' ? 'графический чат' : 'терминал'}. Переключить режим`"
          :title="
            modeOf(row.program) === 'gui'
              ? 'Графический чат — нажмите, чтобы вернуть терминал'
              : 'Терминал — нажмите, чтобы открывать графический чат'
          "
          @click="toggleMode(row.program)"
        >
          <ProjectorIcon
            name="message-square"
            v-if="modeOf(row.program) === 'gui'"
            aria-hidden="true"
          />
          <ProjectorIcon name="terminal" v-else aria-hidden="true" />
        </button>
      </div>
    </UiStack>
    <template v-if="agent && builtin">
      <UiIslandLabel divided>{{ builtin.title }}</UiIslandLabel>
      <UiActionRow
        class="row"
        role="menuitem"
        data-command="ide.workbench.agent.open"
        :tabindex="active === roleRows.length + rows.length ? 0 : -1"
        @mousemove="active = roleRows.length + rows.length"
        @click="openChat"
      >
        <ProjectorIcon :name="builtin.icon" class="row-icon" aria-hidden="true" />
        <UiActionCopy :title="builtin.title" :description="builtin.caption" />
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
/* Split-кнопка шапки: две половины одной подложки, стрелка отделена тонкой чертой */
.split-session {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.split-main {
  gap: var(--sp-1);
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.split-more {
  width: 24px;
  padding-inline: 0;
  border-left-width: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.split-session.open .split-more {
  background: var(--active);
}
.split-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
/* Название программы уступает место иконке, когда шапке тесно */
@media (max-width: 1100px) {
  .split-label {
    display: none;
  }
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
.side {
  display: inline-flex;
  flex-shrink: 0;
  padding: 3px 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
}
.side svg {
  width: 13px;
  height: 13px;
}
.side:hover,
.side:focus-visible {
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
