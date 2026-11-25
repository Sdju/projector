<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentInboxBell } from "../../agent/index.ts";
import LayoutMenu from "./LayoutMenu.vue";
import NewSessionMenu from "./NewSessionMenu.vue";
import type { LayoutPreset } from "../lib/workbench-layout.ts";
import { computed, defineComponent, onBeforeUnmount, ref, useSlots } from "vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { useHiddenActions } from "../lib/hidden-actions.ts";
import { useActionDrag } from "../lib/action-drag.ts";
import { useActionOrder } from "../lib/action-order.ts";
import {
  DOCK_ALIGNS,
  DOCK_MIME,
  dockActionOf,
  dockDragging,
  dockItemId,
  endDockDrag,
  isDockActionName,
  parseDockAlign,
  parseDockEdge,
  useDockLayout,
  type DockAlign,
} from "../lib/dock-layout.ts";
import DockItems from "./DockItems.vue";
import { registerDockActionDelegate } from "../lib/dock-items.ts";

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
const dock = useDockLayout();
const slots = useSlots();
const releases = [
  registerDockActionDelegate("session", {
    component: NewSessionMenu,
    props: () => ({
      variant: "split",
      busy: props.terminalsBusy,
      agent: props.capabilities.agent,
      projectId: props.projectId,
    }),
  }),
  registerDockActionDelegate("layout", {
    component: LayoutMenu,
    props: () => ({
      groups: props.layoutGroups,
      preset: props.preset,
      presetsAvailable: props.presetsAvailable,
      sidebarHidden: props.sidebarHidden,
    }),
  }),
];
for (const [action, name] of [
  ["project-run", "project-run"],
  ["project-repository", "project-repository"],
] as const) {
  if (!slots[name]) continue;
  const component = defineComponent({ setup: () => () => slots[name]?.() });
  releases.push(registerDockActionDelegate(action, { component }));
}
onBeforeUnmount(() => releases.forEach((release) => release()));
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
const alignOfAction = (id: string): DockAlign =>
  !props.mobile && isDockActionName(id) ? dock.alignOf(dockItemId(id)) : "end";
const visibleActions = computed(() =>
  ordering.sort(
    actions.value.filter((item) => !isDockActionName(item.id) && !isHidden(item.id)),
    (item) => item.id,
  ),
);
const actionGroups = computed<Record<DockAlign, typeof actions.value>>(() => ({
  start: visibleActions.value.filter((item) => alignOfAction(item.id) === "start"),
  end: visibleActions.value.filter((item) => alignOfAction(item.id) === "end"),
}));
const dragging = dockDragging;
const draggingId = (id: string) => (isDockActionName(id) ? dockItemId(id) : id);
const { dropTarget, dragStart, dragOver, dragLeave, drop, endDrag } = useActionDrag<string, string>(
  {
    dragging,
    axis: "x",
    mime: DOCK_MIME,
    sourceFor: draggingId,
    canDrop: (from, to) => (dockActionOf(from) ?? from) !== to,
    move: (from, to, after) => {
      const raw = dockActionOf(from) ?? from;
      const known = actions.value.some((item) => item.id === raw && !isDockActionName(item.id));
      if (!known) {
        emit("command", "ide.workbench.dock.item.place", {
          item: from,
          edge: "top",
          align: alignOfAction(to),
        });
        return;
      }
      if (alignOfAction(raw) !== alignOfAction(to)) {
        emit("command", "ide.workbench.dock.item.place", {
          item: from,
          edge: "top",
          align: alignOfAction(to),
        });
        return;
      }
      void commands.scope.executeCommand("ide.workbench.action.move", { from: raw, to, after });
    },
  },
);
const isHidden = (id: string) =>
  visibility.hidden.value.includes(`toolbar:${id}`) ||
  (isDockActionName(id) && dock.isHidden(dockItemId(id)));
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
    if (value.visible) await dock.setHidden(dockItemId(value.action), false);
  },
});
commands.scope.registerCommand({
  id: "ide.workbench.action.place",
  title: "Перенести кнопку между шапкой и нижней строкой",
  description:
    "Переносит кнопку шапки в нижнюю строку или возвращает её наверх. Порядок меняется перетаскиванием.",
  arguments: {
    action: "string: идентификатор действия",
    edge: "string: top или bottom",
    align: "string: start (слева) или end (справа); по умолчанию текущее выравнивание",
  },
  run: async (args) => {
    const value = args as { action?: unknown; edge?: unknown; place?: unknown; align?: unknown };
    const edge = parseDockEdge(value?.edge ?? value?.place);
    const align = value.align === undefined ? undefined : parseDockAlign(value.align);
    if (typeof value?.action !== "string" || !edge) throw new Error("Укажите action и edge");
    if (value.align !== undefined && !align) throw new Error("Укажите align: start или end");
    if (!isDockActionName(value.action)) throw new Error("Эта кнопка не показывается в панелях");
    await dock.place(dockItemId(value.action), edge, align);
  },
});
const contextItems = computed<ContextMenuItem[]>(() => {
  const id = target.value;
  const items: ContextMenuItem[] = [];
  if (isDockActionName(id))
    items.push({
      id: "place-bottom",
      label: "Вниз",
      icon: "arrow-down",
      command: "ide.workbench.action.place",
      args: { action: id, edge: "bottom" },
      run: () => {
        void commands.scope.executeCommand("ide.workbench.action.place", {
          action: id,
          edge: "bottom",
        });
      },
    });
  items.push({
    id: "hide",
    label: "Скрыть",
    icon: "eye-off",
    separator: items.length > 0,
    command: "ide.workbench.action.visibility.set",
    args: { action: id, visible: false },
    run: () => {
      void commands.scope.executeCommand("ide.workbench.action.visibility.set", {
        action: id,
        visible: false,
      });
    },
  });
  return items;
});

function dragOverBar(event: DragEvent) {
  if (!dockDragging.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function dropOnBar(event: DragEvent) {
  const item = dockDragging.value;
  if (!item) return;
  event.preventDefault();
  const raw = dockActionOf(item) ?? item;
  const known = actions.value.some((action) => action.id === raw && !isDockActionName(action.id));
  if (known) {
    const visible = actionGroups.value[alignOfAction(raw)]
      .map((action) => action.id)
      .filter((id) => id !== raw);
    const last = visible.at(-1);
    if (last) {
      void commands.scope.executeCommand("ide.workbench.action.move", {
        from: raw,
        to: last,
        after: true,
      });
      endDockDrag();
      return;
    }
  }
  emit("command", "ide.workbench.dock.item.place", { item, edge: "top" });
  endDockDrag();
}
function openContext(event: MouseEvent, id: string) {
  target.value = id;
  void context.value?.open(event, event.currentTarget as HTMLElement);
}
</script>

<template>
  <div
    class="toolbar"
    role="toolbar"
    aria-label="Блоки и терминалы"
    @dragenter="dragOverBar"
    @dragover="dragOverBar"
    @drop.stop="dropOnBar"
  >
    <slot name="terminal-status" />
    <p v-if="terminalsError" class="toolbar-error u-truncate" role="alert">
      {{ terminalsError }}
    </p>
    <template v-for="align in DOCK_ALIGNS" :key="align">
      <DockItems
        edge="top"
        :align="align"
        :inbox="inbox"
        @command="(id, args) => emit('command', id, args)"
      />
      <span
        v-for="item in actionGroups[align]"
        :key="item.id"
        class="sortable-action"
        draggable="true"
        :class="{
          dragging: dragging === draggingId(item.id),
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
          <ProjectorIcon name="sparkles" v-if="item.id === 'media'" aria-hidden="true" />
          <ProjectorIcon
            name="chart-no-axes-column"
            v-else-if="item.id === 'analytics'"
            aria-hidden="true"
          />
          <ProjectorIcon name="settings-2" v-else aria-hidden="true" />
        </UiButton>
      </span>
      <div v-if="align === 'start'" class="toolbar-spacer" />
    </template>
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
        ><ProjectorIcon name="menu" aria-hidden="true" /></UiButton
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
          ><ProjectorIcon name="eye" aria-hidden="true"
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
