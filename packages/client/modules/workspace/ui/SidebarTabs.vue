<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { useHiddenActions } from "../lib/hidden-actions.ts";
import { useActionDrag } from "../lib/action-drag.ts";
import type { SidebarAlign, SidebarLayout, SidebarSide } from "../lib/sidebar-layout.ts";
import { groupSidebar } from "../../workspace-api/index.ts";

export interface SidebarItem {
  id: string;
  title: string;
  /** Shared icon name; the rail renders it through the icon service. */
  icon: string;
  badge: number;
  command?: string;
  /** Родительский раздел: иконка стоит рядом с ним в общей подложке. */
  group?: string;
  /** Вид раздела, по которому берутся компонент и подписи. */
  kind?: string;
  /** Временный раздел можно закрыть. */
  closable?: boolean;
  /** Служебный раздел (Hub, корзина): живёт в нижней группе вертикальной полосы. */
  utility?: boolean;
}
const props = defineProps<{
  section: string;
  side: SidebarSide;
  layout: SidebarLayout;
  items: SidebarItem[];
  /** Вертикальная полоса-остров слева от панели; без неё — горизонтальные вкладки (мобильный вид). */
  vertical?: boolean;
  /** Панель раздела свёрнута: активный раздел не подсвечивается. */
  collapsed?: boolean;
  /** У проекта есть свои настройки: кнопка стоит на полосе разделов. */
  projectSettings?: boolean;
  /** Название полосы разделов для экранных дикторов. */
  label?: string;
  /** Separate command scopes for the left sidebar and the right rail on one page. */
  scopeId?: string;
  /** The section is reloading: the mobile refresh button shows a spinner. */
  refreshing?: boolean;
  /** Command of the refresh button in the compact (non-rail) bar. */
  refreshCommand?: string;
}>();
const emit = defineEmits<{
  "update:section": [section: string];
  command: [id: string, args?: unknown];
}>();

// Compact view: one titled picker instead of a row of bare icons.
const picker = useIslandMenu({
  anchor: "left",
  initialFocus: [".section-item.selected", ".section-item"],
  items: ".section-item",
});
const overflow = useIslandMenu({ anchor: "left", initialFocus: ".section-item" });
const visibility = useHiddenActions();
const layout = props.layout;
const dragging = layout.drag;
const { dropTarget, dragStart, dragOver, dragLeave, drop, endDrag } = useActionDrag<
  { id: string; side: SidebarSide },
  string | undefined
>({
  dragging,
  axis: "y",
  mime: "application/x-projector-sidebar-section",
  sourceFor: (id) => ({ id, side: props.side }),
  canDrop: (from, to) => layout.canMove(from.id, props.side, to),
  move: (from, to, after) =>
    emit("command", "ide.workbench.section.move", { from: from.id, side: props.side, to, after }),
});
const oppositeSide = computed(() => (props.side === "left" ? "right" : "left"));
const emptyDrop = computed(
  () =>
    dragging.value &&
    layout.canMove(dragging.value.id, props.side) &&
    !groups.value.some(({ id }) => layout.canMove(dragging.value!.id, props.side, id)),
);
function canAlignDrop(align: SidebarAlign): boolean {
  const item = dragging.value;
  return !!item && layout.canAlign(item.id) && layout.alignOf(item.id) !== align;
}
function alignDragOver(event: DragEvent, align: SidebarAlign) {
  if (!canAlignDrop(align)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function alignDrop(event: DragEvent, align: SidebarAlign) {
  const item = dragging.value;
  if (!item || !canAlignDrop(align)) return;
  event.preventDefault();
  emit("command", "ide.workbench.section.align", { section: item.id, align });
  endDrag();
}
const keyFor = (id: string) => `sidebar:${id}`;
const settingsItem: SidebarItem = {
  id: "project-settings",
  title: "Настройки проекта",
  icon: "sliders-horizontal",
  badge: 0,
  command: "ide.workbench.project.settings.open",
};
const hiddenItems = computed(() =>
  [...props.items, ...(props.projectSettings ? [settingsItem] : [])].filter((item) =>
    visibility.hidden.value.includes(keyFor(item.id)),
  ),
);
/** Служебные разделы идут после проектных; на полосе они образуют нижнюю группу. */
const groups = computed(() => {
  const all = groupSidebar(props.items)
    .map(([root, ...children]) => ({
      id: root!.id,
      utility: !!root!.utility,
      align: layout.alignOf(root!.id),
      items: [root!, ...children].filter(
        (item) => !props.vertical || !visibility.hidden.value.includes(keyFor(item.id)),
      ),
    }))
    .filter((group) => group.items.length);
  return [
    ...layout.sort(all.filter((group) => group.align === "start")),
    ...layout.sort(all.filter((group) => group.align === "end")),
  ];
});
const firstEnd = computed(() => groups.value.find((group) => group.align === "end"));
const ordered = computed(() => groups.value.flatMap((group) => group.items));
const current = computed(() => ordered.value.find((item) => item.id === props.section));
const otherBadges = computed(() =>
  ordered.value.some((item) => item.id !== props.section && item.badge),
);
const commands = useCommandScope(props.scopeId ?? "sidebar-sections", () => ({
  surface: "workbench",
}));
commands.scope.registerCommand({
  id: "ide.workbench.section.picker.toggle",
  title: "Открыть или закрыть выбор раздела",
  description:
    "Показывает список разделов проекта (файлы, поиск, Git и другие) в мобильной боковой панели.",
  enabled: () => !props.vertical,
  run: () => void picker.toggle(),
});
commands.scope.registerCommand({
  id: "ide.workbench.section.hidden.toggle",
  title: "Открыть скрытые разделы",
  description: "Открывает или закрывает список скрытых кнопок разделов.",
  run: () => void overflow.toggle(),
});
commands.scope.registerCommand({
  id: "ide.workbench.section.visibility.set",
  title: "Изменить видимость раздела",
  description: "Скрывает кнопку раздела или возвращает её на боковую панель.",
  arguments: { section: "string: идентификатор раздела", visible: "boolean: показывать кнопку" },
  run: async (args) => {
    const value = args as { section?: unknown; visible?: unknown };
    if (typeof value?.section !== "string" || typeof value.visible !== "boolean")
      throw new Error("Укажите section и visible");
    await visibility.setHidden(keyFor(value.section), !value.visible);
  },
});
const sectionMenu = ref<InstanceType<typeof ContextMenu>>();
const menuTarget = ref<SidebarItem>();
const menuItems = computed<ContextMenuItem[]>(() => {
  const item = menuTarget.value;
  if (!item) return [];
  return [
    ...(layout.canMove(item.id, oppositeSide.value)
      ? [
          {
            id: "section.move",
            label: `Переместить ${oppositeSide.value === "right" ? "вправо" : "влево"}`,
            command: "ide.workbench.section.move",
            args: { from: item.id, side: oppositeSide.value },
            run: () =>
              emit("command", "ide.workbench.section.move", {
                from: item.id,
                side: oppositeSide.value,
              }),
          },
        ]
      : []),
    ...(layout.canAlign(item.id)
      ? [
          {
            id: "section.align",
            label: layout.alignOf(item.id) === "start" ? "Вниз" : "Наверх",
            icon: layout.alignOf(item.id) === "start" ? "arrow-down" : "arrow-up",
            command: "ide.workbench.section.align",
            args: {
              section: item.id,
              align: layout.alignOf(item.id) === "start" ? "end" : "start",
            },
            run: () =>
              emit("command", "ide.workbench.section.align", {
                section: item.id,
                align: layout.alignOf(item.id) === "start" ? "end" : "start",
              }),
          },
        ]
      : []),
    {
      id: "section.hide",
      label: `Скрыть «${item.title}»`,
      icon: "eye-off",
      command: "ide.workbench.section.visibility.set",
      args: { section: item.id, visible: false },
      run: () =>
        commands.scope.executeCommand("ide.workbench.section.visibility.set", {
          section: item.id,
          visible: false,
        }),
    },
    ...(item.closable
      ? [
          {
            id: "section.close",
            label: `Закрыть «${item.title}»`,
            icon: "x",
            command: "ide.workbench.section.close",
            args: { section: item.id },
            run: () => emit("command", "ide.workbench.section.close", { section: item.id }),
          },
        ]
      : []),
  ];
});
function openSectionMenu(event: MouseEvent, item: SidebarItem) {
  if (!props.vertical) return;
  event.preventDefault();
  event.stopPropagation();
  menuTarget.value = item;
  void sectionMenu.value?.open(event, event.currentTarget as HTMLElement);
}
function choose(item: SidebarItem) {
  picker.close();
  if (item.command) emit("command", item.command);
  else emit("update:section", item.id);
}
</script>

<template>
  <nav v-if="!vertical" class="side-tabs picker-bar" :aria-label="label ?? 'Разделы проекта'">
    <span :ref="picker.trigger" class="picker">
      <button
        class="current"
        aria-haspopup="dialog"
        :aria-expanded="picker.open.value"
        :aria-controls="picker.open.value ? picker.id : undefined"
        data-command="ide.workbench.section.picker.toggle"
        @click="commands.run('ide.workbench.section.picker.toggle')"
      >
        <ProjectorIcon v-if="current" :name="current.icon" aria-hidden="true" />
        <span class="name">{{ current?.title ?? "Разделы" }}</span>
        <span v-if="current?.badge" class="count" aria-hidden="true">{{ current.badge }}</span>
        <UiStatusDot
          v-else-if="otherBadges"
          as="i"
          class="dot"
          radius="circle"
          shrink
          tone="success"
          aria-hidden="true"
        />
        <ProjectorIcon name="chevron-down" class="chevron" aria-hidden="true" />
      </button>
    </span>
    <div class="side-actions">
      <UiButton
        shape="icon"
        size="sm"
        title="Обновить раздел"
        :aria-label="refreshing ? 'Обновление раздела' : 'Обновить раздел'"
        :data-command="refreshCommand ?? 'ide.workbench.sidebar.refresh'"
        :busy="refreshing"
        @click="emit('command', refreshCommand ?? 'ide.workbench.sidebar.refresh')"
      >
        <ProjectorIcon name="rotate-cw" aria-hidden="true" />
      </UiButton>
    </div>
  </nav>
  <UiIsland v-if="!vertical" :menu="picker" :label="label ?? 'Разделы проекта'" :width="260">
    <button
      v-for="item in ordered"
      :key="item.id"
      class="section-item"
      :class="{ selected: section === item.id, subgroup: !!item.group }"
      :aria-current="section === item.id ? 'true' : undefined"
      @click="choose(item)"
    >
      <ProjectorIcon
        :name="item.icon"
        :class="{ 'git-logo': item.id === 'git' }"
        aria-hidden="true"
      />
      <span class="label">{{ item.title }}</span>
      <span v-if="item.badge" class="count" aria-hidden="true">{{ item.badge }}</span>
      <ProjectorIcon name="check" v-if="section === item.id" class="check" aria-hidden="true" />
    </button>
    <button
      v-if="projectSettings"
      class="section-item"
      data-command="ide.workbench.project.settings.open"
      @click="
        picker.close();
        emit('command', 'ide.workbench.project.settings.open');
      "
    >
      <ProjectorIcon name="sliders-horizontal" aria-hidden="true" />
      <span class="label">Настройки проекта</span>
    </button>
  </UiIsland>
  <nav v-else class="side-tabs vertical" :aria-label="label ?? 'Разделы проекта'">
    <div
      v-if="dragging && canAlignDrop('start')"
      class="rail-align-drop"
      data-align="start"
      title="Переместить наверх"
      @dragover="alignDragOver($event, 'start')"
      @drop.stop="alignDrop($event, 'start')"
    >
      <ProjectorIcon name="arrow-up" aria-hidden="true" />
    </div>
    <template v-for="group in groups" :key="group.id">
      <i v-if="group === firstEnd" class="rail-divider" aria-hidden="true" />
      <div
        class="side-group"
        :class="{
          grouped: group.items.length > 1,
          dragging: dragging?.id === group.id && dragging.side === side,
          'drop-before': dropTarget?.id === group.id && !dropTarget.after,
          'drop-after': dropTarget?.id === group.id && dropTarget.after,
        }"
        draggable="true"
        @dragstart="dragStart($event, group.id)"
        @dragend="endDrag"
        @dragover="dragOver($event, group.id)"
        @dragleave="dragLeave"
        @drop.stop="drop($event, group.id)"
      >
        <template v-for="(item, index) in group.items" :key="item.id">
          <i v-if="index" class="side-separator" aria-hidden="true" />
          <button
            :class="{ selected: section === item.id && !collapsed }"
            :aria-pressed="section === item.id && !collapsed"
            :title="item.closable ? `${item.title} · ПКМ: закрыть` : item.title"
            :aria-label="item.badge ? `${item.title}: ${item.badge}` : item.title"
            aria-haspopup="menu"
            @click="item.command ? emit('command', item.command) : emit('update:section', item.id)"
            @contextmenu="openSectionMenu($event, item)"
          >
            <ProjectorIcon
              :name="item.icon"
              :class="{ 'git-logo': item.id === 'git' }"
              aria-hidden="true"
            />
            <span v-if="item.badge" aria-hidden="true">{{ item.badge }}</span>
          </button>
        </template>
      </div>
    </template>
    <div
      v-if="emptyDrop"
      class="side-group empty-drop"
      :class="{ 'drop-before': dropTarget && !dropTarget.id }"
      @dragover="dragOver($event, undefined)"
      @dragleave="dragLeave"
      @drop.stop="drop($event, undefined)"
    />
    <i v-if="!firstEnd" class="rail-divider" aria-hidden="true" />
    <span :ref="overflow.trigger" class="overflow-trigger">
      <UiButton
        shape="icon"
        size="sm"
        title="Скрытые разделы"
        aria-label="Скрытые разделы"
        aria-haspopup="dialog"
        :aria-expanded="overflow.open.value"
        data-command="ide.workbench.section.hidden.toggle"
        @click="commands.run('ide.workbench.section.hidden.toggle')"
        ><ProjectorIcon name="menu" aria-hidden="true"
      /></UiButton>
    </span>
    <div
      v-if="projectSettings && !visibility.hidden.value.includes(keyFor(settingsItem.id))"
      class="side-actions"
    >
      <UiButton
        shape="icon"
        size="sm"
        title="Настройки проекта"
        aria-label="Настройки проекта"
        data-command="ide.workbench.project.settings.open"
        @click="emit('command', 'ide.workbench.project.settings.open')"
        @contextmenu="openSectionMenu($event, settingsItem)"
      >
        <ProjectorIcon name="sliders-horizontal" aria-hidden="true" />
      </UiButton>
    </div>
    <div
      v-if="dragging && canAlignDrop('end')"
      class="rail-align-drop"
      data-align="end"
      title="Переместить вниз"
      @dragover="alignDragOver($event, 'end')"
      @drop.stop="alignDrop($event, 'end')"
    >
      <ProjectorIcon name="arrow-down" aria-hidden="true" />
    </div>
  </nav>
  <UiIsland v-if="vertical" :menu="overflow" label="Скрытые разделы" :width="280">
    <p v-if="visibility.error.value" role="alert">{{ visibility.error.value }}</p>
    <p v-if="!hiddenItems.length" class="empty">Скрытых разделов нет</p>
    <div v-for="item in hiddenItems" :key="item.id" class="hidden-row">
      <button
        class="section-item"
        @click="
          overflow.close();
          choose(item);
        "
      >
        <ProjectorIcon :name="item.icon" aria-hidden="true" /><span class="label">{{
          item.title
        }}</span>
        <span v-if="item.badge" class="count">{{ item.badge }}</span>
      </button>
      <UiButton
        shape="icon"
        size="sm"
        :title="`Вернуть «${item.title}»`"
        :aria-label="`Вернуть «${item.title}»`"
        data-command="ide.workbench.section.visibility.set"
        @click="
          commands.run('ide.workbench.section.visibility.set', { section: item.id, visible: true })
        "
        ><ProjectorIcon name="eye" aria-hidden="true"
      /></UiButton>
    </div>
  </UiIsland>
  <ContextMenu ref="sectionMenu" :items="menuItems" label="Действия раздела" />
</template>

<style scoped>
.side-tabs.vertical .side-group {
  position: relative;
}
.side-group.drop-before::before,
.side-group.drop-after::after {
  content: "";
  position: absolute;
  left: 2px;
  right: 2px;
  height: 2px;
  background: var(--focus);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1;
}
.side-group.drop-before::before {
  top: -3px;
}
.side-group.drop-after::after {
  bottom: -3px;
}

.side-group.empty-drop {
  min-height: 28px;
  flex-shrink: 0;
  border: 1px dashed var(--line-strong);
}
.rail-align-drop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  min-height: 28px;
  flex-shrink: 0;
  border: 1px dashed var(--focus);
  border-radius: var(--r-md);
  color: var(--focus);
}
.rail-align-drop svg {
  width: 14px;
  height: 14px;
}
.side-group.dragging {
  opacity: 0.4;
}
.overflow-trigger {
  display: flex;
}
.hidden-row {
  display: flex;
  align-items: center;
  border-radius: var(--r-md);
}
.hidden-row:hover {
  background: var(--hover);
}
.hidden-row .section-item {
  flex: 1;
  min-width: 0;
}
.hidden-row .section-item:hover {
  background: transparent;
}
.empty {
  margin: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.side-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  align-items: stretch;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
}
.side-tabs > button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-width: 24px;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--muted);
  border-bottom: 2px solid transparent;
  transition: color var(--t-fast);
}
.side-tabs > button:hover {
  color: var(--text);
}
.side-tabs > button.selected {
  color: var(--text);
  border-color: var(--focus);
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
  flex-shrink: 0;
}
.side-tabs > button svg {
  width: 14px;
  height: 14px;
}
.git-logo :deep(path) {
  fill: currentColor;
}
.side-tabs span {
  color: var(--run);
  font: var(--fs-2xs) var(--mono);
}
/* Вертикальная полоса лежит прямо на фоне рабочей области, без рамки: островом остаётся только панель */
.side-tabs.vertical {
  flex-direction: column;
  align-items: center;
  width: calc(var(--rail-w, 40px) - var(--island-gap));
  height: auto;
  gap: var(--sp-1);
  padding: 0;
  border: 0;
}
.side-tabs.vertical .side-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 32px;
  border-radius: var(--r-md);
}
/* Дочерние разделы делят подложку с родителем: это одна «стопка», а не отдельные кнопки */
.side-tabs.vertical .side-group.grouped {
  background: var(--bg-2);
}
/* Нижняя группа служебных разделов: тонкая черта прижата к низу, настройки проекта идут следом */
.side-tabs.vertical .rail-divider {
  width: 16px;
  height: 1px;
  flex-shrink: 0;
  margin-top: auto;
  background: var(--line-strong);
}
.side-tabs.vertical .rail-divider ~ .side-actions {
  margin-top: 0;
}
.side-tabs.vertical .side-separator {
  width: 16px;
  height: 1px;
  flex-shrink: 0;
  background: var(--line-strong);
}
.side-tabs.vertical .side-group > button {
  position: relative;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--r-md);
}
.side-tabs.vertical .side-group > button:hover {
  background: var(--hover);
}
.side-tabs.vertical .side-group > button.selected {
  background: var(--active);
}
.side-tabs.vertical .side-group > button svg {
  width: 16px;
  height: 16px;
}
.side-tabs.vertical .side-group > button span {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 14px;
  padding: 0 3px;
  border-radius: var(--r-full);
  background: var(--bg-3);
  line-height: 14px;
  text-align: center;
}
.side-tabs.vertical .side-actions {
  flex-direction: column;
  margin: auto 0 0;
  padding: 0;
  border-left: 0;
  gap: var(--sp-1);
}
/* Мобильная полоса: название раздела с выбором и одна кнопка обновления */
.picker-bar {
  height: 48px;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-2);
}
.picker {
  display: flex;
  min-width: 0;
}
.current {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 40px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  color: var(--text);
  font: 600 var(--fs-md) var(--sans);
}
.picker-bar .current .name {
  color: var(--text);
  font: inherit;
}
.picker-bar .current .count {
  font: var(--fs-2xs) var(--mono);
}
.current:active,
.current[aria-expanded="true"] {
  background: var(--active);
}
.current svg {
  width: 17px;
  height: 17px;
  color: var(--muted);
}
.current .chevron {
  width: 14px;
  height: 14px;
}
.current .count,
.section-item .count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--r-full);
  background: var(--bg-3);
  color: var(--run);
  font: var(--fs-2xs) var(--mono);
  line-height: 18px;
  text-align: center;
}
.picker-bar .side-actions {
  border-left: 0;
  padding-left: 0;
}
.section-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--control-h);
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  color: var(--text);
  text-align: left;
}
.section-item:hover,
.section-item:focus-visible {
  background: var(--hover);
  outline: none;
}
.section-item.selected {
  background: var(--active);
}
.section-item.subgroup {
  padding-left: calc(var(--sp-3) * 2);
}
.section-item svg {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  color: var(--muted);
}
.section-item .label {
  flex: 1;
}
.section-item .check {
  color: var(--focus);
}
</style>
