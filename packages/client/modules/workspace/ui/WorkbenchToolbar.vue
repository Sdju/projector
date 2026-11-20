<script setup lang="ts">
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentInboxBell } from "../../agent/index.ts";
import LayoutMenu from "./LayoutMenu.vue";
import NewSessionMenu from "./NewSessionMenu.vue";
import type { LayoutPreset } from "../lib/workbench-layout.ts";
import IconAnalytics from "~icons/lucide/chart-no-axes-column";
import IconMedia from "~icons/lucide/sparkles";
import IconSettings from "~icons/lucide/settings-2";
import IconMenu from "~icons/lucide/menu";
import IconEyeOff from "~icons/lucide/eye-off";
import IconEye from "~icons/lucide/eye";
import { computed, ref, useSlots } from "vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { useHiddenActions } from "../lib/hidden-actions.ts";
import { useActionDrag } from "../lib/action-drag.ts";
import { useActionOrder } from "../lib/action-order.ts";

const props = defineProps<{
  projectId: string;
  capabilities: Readonly<WorkspaceCapabilities>;
  /** Узкий экран: раскладка блоков заменена поверхностями, остаются запуск и ссылки. */
  mobile?: boolean;
  sidebarHidden: boolean;
  terminalsBusy: boolean;
  terminalsError?: string;
  /** Блоки дока и выбранная готовая раскладка для острова раскладки. */
  layoutGroups: { id: string; role?: string; label: string; hidden: boolean }[];
  preset?: LayoutPreset;
  presetsAvailable: boolean;
  /** The profile has the global work inbox tab: the bell opens it. */
  inbox?: boolean;
}>();
const emit = defineEmits<{
  command: [id: string, args?: unknown];
}>();
const visibility = useHiddenActions();
const slots = useSlots();
const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ".hidden-action button",
  ignore: [".island"],
});
const context = ref<InstanceType<typeof ContextMenu>>();
const target = ref("");
const actions = computed(() => [
  ...(props.capabilities.terminals && !props.mobile
    ? [{ id: "session", title: "Новая сессия" }]
    : []),
  ...(slots["project-run"] ? [{ id: "project-run", title: "Сценарии проекта" }] : []),
  ...(slots["project-repository"] ? [{ id: "project-repository", title: "Репозиторий" }] : []),
  ...(props.inbox ? [{ id: "inbox", title: "Входящие" }] : []),
  { id: "media", title: "Генерация медиа" },
  { id: "analytics", title: "Аналитика расхода" },
  { id: "settings", title: "Настройки Projector" },
  ...(!props.mobile ? [{ id: "layout", title: "Раскладка" }] : []),
]);
const ordering = useActionOrder("toolbar");
const visibleActions = computed(() =>
  ordering.sort(
    actions.value.filter((item) => !isHidden(item.id)),
    (item) => item.id,
  ),
);
const dragging = ref<string>();
const { dropTarget, dragStart, dragOver, dragLeave, drop, endDrag } = useActionDrag<string, string>(
  {
    dragging,
    axis: "x",
    mime: "text/plain",
    sourceFor: (id) => id,
    canDrop: (from, to) => from !== to,
    move: (from, to, after) => {
      void commands.scope.executeCommand("ide.workbench.action.move", { from, to, after });
    },
  },
);
const isHidden = (id: string) => visibility.hidden.value.includes(`toolbar:${id}`);
const hiddenActions = computed(() => actions.value.filter((item) => isHidden(item.id)));
const commands = useCommandScope("workbench-hidden-actions", () => ({ surface: "workbench" }));
commands.scope.registerCommand({
  id: "ide.workbench.action.move",
  title: "Переместить кнопку шапки",
  description: "Меняет порядок кнопок шапки и сохраняет его.",
  arguments: {
    from: "string: перемещаемая кнопка",
    to: "string: соседняя кнопка",
    after: "boolean: разместить после",
  },
  run: async (args) => {
    const value = args as { from?: unknown; to?: unknown; after?: unknown };
    if (
      typeof value?.from !== "string" ||
      typeof value.to !== "string" ||
      typeof value.after !== "boolean"
    )
      throw new Error("Укажите from, to и after");
    await ordering.move(
      visibleActions.value.map((item) => item.id),
      value.from,
      value.to,
      value.after,
      actions.value.map((item) => item.id),
    );
  },
});
commands.scope.registerCommand({
  id: "ide.workbench.actions.hidden.toggle",
  title: "Открыть скрытые действия",
  description: "Открывает или закрывает список скрытых кнопок шапки.",
  run: () => void menu.toggle(),
});
commands.scope.registerCommand({
  id: "ide.workbench.action.visibility.set",
  title: "Изменить видимость кнопки шапки",
  description: "Скрывает кнопку шапки или возвращает её обратно.",
  arguments: { action: "string: идентификатор действия", visible: "boolean: показывать кнопку" },
  run: async (args) => {
    const value = args as { action?: unknown; visible?: unknown };
    if (typeof value?.action !== "string" || typeof value.visible !== "boolean")
      throw new Error("Укажите action и visible");
    await visibility.setHidden(`toolbar:${value.action}`, !value.visible);
  },
});
const contextItems = computed(() => [
  {
    id: "hide",
    label: "Скрыть",
    icon: IconEyeOff,
    command: "ide.workbench.action.visibility.set",
    args: { action: target.value, visible: false },
    run: async () => {
      await commands.scope.executeCommand("ide.workbench.action.visibility.set", {
        action: target.value,
        visible: false,
      });
    },
  },
]);
function openContext(event: MouseEvent, id: string) {
  target.value = id;
  void context.value?.open(event, event.currentTarget as HTMLElement);
}
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="Блоки и терминалы">
    <slot name="terminal-status" />
    <p v-if="terminalsError" class="toolbar-error u-truncate" role="alert">
      {{ terminalsError }}
    </p>
    <div class="toolbar-spacer" />
    <span
      v-for="item in visibleActions"
      :key="item.id"
      class="sortable-action"
      draggable="true"
      :class="{
        dragging: dragging === item.id,
        'drop-before': dropTarget?.id === item.id && !dropTarget.after,
        'drop-after': dropTarget?.id === item.id && dropTarget.after,
      }"
      @dragstart="dragStart($event, item.id)"
      @dragend="endDrag"
      @dragover="dragOver($event, item.id)"
      @dragleave="dragLeave"
      @drop.stop="drop($event, item.id)"
      @contextmenu="openContext($event, item.id)"
    >
      <NewSessionMenu
        v-if="item.id === 'session'"
        variant="split"
        :busy="terminalsBusy"
        :agent="capabilities.agent"
        :project-id="projectId"
        @command="(id, args) => emit('command', id, args)"
      />
      <slot v-else-if="item.id === 'project-run'" name="project-run" />
      <slot v-else-if="item.id === 'project-repository'" name="project-repository" />
      <AgentInboxBell
        v-else-if="item.id === 'inbox'"
        @open="emit('command', 'ide.workbench.inbox.open')"
      />
      <LayoutMenu
        v-else-if="item.id === 'layout'"
        :groups="layoutGroups"
        :preset="preset"
        :presets-available="presetsAvailable"
        :sidebar-hidden="sidebarHidden"
        @command="(id, args) => emit('command', id, args)"
      />
      <UiButton
        v-else
        shape="icon"
        size="sm"
        :title="item.title"
        :aria-label="item.title"
        :data-command="
          item.id === 'media'
            ? 'ide.media.open'
            : item.id === 'analytics'
              ? 'ide.workbench.analytics.open'
              : 'ide.workbench.settings.open'
        "
        @click="
          emit(
            'command',
            item.id === 'media'
              ? 'ide.media.open'
              : item.id === 'analytics'
                ? 'ide.workbench.analytics.open'
                : 'ide.workbench.settings.open',
          )
        "
      >
        <IconMedia v-if="item.id === 'media'" aria-hidden="true" />
        <IconAnalytics v-else-if="item.id === 'analytics'" aria-hidden="true" />
        <IconSettings v-else aria-hidden="true" />
      </UiButton>
    </span>
    <span :ref="menu.trigger"
      ><UiButton
        shape="icon"
        size="sm"
        title="Скрытые действия"
        aria-label="Скрытые действия"
        aria-haspopup="dialog"
        :aria-expanded="menu.open.value"
        data-command="ide.workbench.actions.hidden.toggle"
        @click="commands.run('ide.workbench.actions.hidden.toggle')"
        ><IconMenu aria-hidden="true" /></UiButton
    ></span>
    <UiIsland :menu="menu" label="Скрытые действия" :width="300">
      <p v-if="visibility.error.value" role="alert">{{ visibility.error.value }}</p>
      <p v-if="!hiddenActions.length" class="empty">Скрытых действий нет</p>
      <div v-for="item in hiddenActions" :key="item.id" class="hidden-action">
        <slot v-if="item.id === 'project-run'" name="project-run" />
        <slot v-else-if="item.id === 'project-repository'" name="project-repository" />
        <NewSessionMenu
          v-else-if="item.id === 'session'"
          variant="split"
          :busy="terminalsBusy"
          :agent="capabilities.agent"
          :project-id="projectId"
          @command="(id, args) => emit('command', id, args)"
        />
        <AgentInboxBell
          v-else-if="item.id === 'inbox'"
          @open="emit('command', 'ide.workbench.inbox.open')"
        />
        <LayoutMenu
          v-else-if="item.id === 'layout'"
          :groups="layoutGroups"
          :preset="preset"
          :presets-available="presetsAvailable"
          :sidebar-hidden="sidebarHidden"
          @command="(id, args) => emit('command', id, args)"
        />
        <button
          v-else
          class="hidden-run"
          @click="
            menu.close();
            emit(
              'command',
              item.id === 'media'
                ? 'ide.media.open'
                : item.id === 'analytics'
                  ? 'ide.workbench.analytics.open'
                  : 'ide.workbench.settings.open',
            );
          "
        >
          {{ item.title }}
        </button>
        <span
          v-if="
            ['session', 'inbox', 'layout', 'project-run', 'project-repository'].includes(item.id)
          "
          class="hidden-label"
          >{{ item.title }}</span
        >
        <UiButton
          shape="icon"
          size="sm"
          :title="`Вернуть «${item.title}»`"
          :aria-label="`Вернуть «${item.title}»`"
          data-command="ide.workbench.action.visibility.set"
          @click="
            commands.run('ide.workbench.action.visibility.set', { action: item.id, visible: true })
          "
          ><IconEye aria-hidden="true"
        /></UiButton>
      </div>
    </UiIsland>
    <ContextMenu ref="context" :items="contextItems" label="Действия кнопки" />
  </div>
</template>

<style scoped>
.sortable-action {
  position: relative;
}
.sortable-action.drop-before::before,
.sortable-action.drop-after::after {
  content: "";
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--focus);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1;
}
.sortable-action.drop-before::before {
  left: -5px;
}
.sortable-action.drop-after::after {
  right: -5px;
}

.sortable-action {
  display: flex;
}
.sortable-action.dragging {
  opacity: 0.4;
}
.hidden-action {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1);
  border-radius: var(--r-md);
}
.hidden-action:hover {
  background: var(--hover);
}
.hidden-run,
.hidden-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  color: var(--text);
  font-size: var(--fs-xs);
}
.hidden-run {
  padding: var(--sp-2);
  border-radius: var(--r-md);
}
.empty {
  margin: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
/* На десктопе полоса телепортируется в шапку и живёт на общем фоне, без собственной подложки */
.toolbar {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  min-height: var(--control-h);
}
.toolbar-spacer {
  flex: 1;
}
.toolbar-error {
  min-width: 0;
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
.toolbar :deep(svg) {
  width: 14px;
  height: 14px;
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .toolbar {
    flex: none;
    gap: var(--sp-1);
  }
  .toolbar-spacer {
    display: none;
  }
  .toolbar-error {
    display: none;
  }
}
</style>
