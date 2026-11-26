<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { useHiddenActions } from "../lib/hidden-actions.ts";
import { useActionDrag } from "../lib/action-drag.ts";
import type { SidebarAlign, SidebarLayout, SidebarSide } from "../lib/sidebar-layout.ts";
import { groupSidebar } from "../../workspace-api/index.ts";

import SidebarHiddenSections from "./SidebarHiddenSections.vue";
import SidebarSectionPicker from "./SidebarSectionPicker.vue";
import type { SidebarItem } from "../lib/sidebar-item.ts";
export type { SidebarItem } from "../lib/sidebar-item.ts";

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
  initialFocus: [".sidebar-section-item.selected", ".sidebar-section-item"],
  items: ".sidebar-section-item",
});
const overflow = useIslandMenu({ anchor: "left", initialFocus: ".sidebar-section-item" });
const visibility = useHiddenActions();
const dragging = computed({
  get: () => props.layout.drag.value,
  set: (value) => {
    props.layout.drag.value = value;
  },
});
const { dropTarget, dragStart, dragOver, dragLeave, drop, endDrag } = useActionDrag<
  { id: string; side: SidebarSide },
  string | undefined
>({
  dragging,
  axis: "y",
  mime: "application/x-projector-sidebar-section",
  sourceFor: (id) => ({ id, side: props.side }),
  canDrop: (from, to) => props.layout.canMove(from.id, props.side, to),
  move: (from, to, after) =>
    emit("command", "ide.workbench.section.move", { from: from.id, side: props.side, to, after }),
});
const oppositeSide = computed(() => (props.side === "left" ? "right" : "left"));
const emptyDrop = computed(
  () =>
    dragging.value &&
    props.layout.canMove(dragging.value.id, props.side) &&
    !groups.value.some(({ id }) => props.layout.canMove(dragging.value!.id, props.side, id)),
);
function canAlignDrop(align: SidebarAlign): boolean {
  const item = dragging.value;
  return !!item && props.layout.canAlign(item.id) && props.layout.alignOf(item.id) !== align;
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
      align: props.layout.alignOf(root!.id),
      items: [root!, ...children].filter(
        (item) => !props.vertical || !visibility.hidden.value.includes(keyFor(item.id)),
      ),
    }))
    .filter((group) => group.items.length);
  return [
    ...props.layout.sort(all.filter((group) => group.align === "start")),
    ...props.layout.sort(all.filter((group) => group.align === "end")),
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
    ...(props.layout.canMove(item.id, oppositeSide.value)
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
    ...(props.layout.canAlign(item.id)
      ? [
          {
            id: "section.align",
            label: props.layout.alignOf(item.id) === "start" ? "Вниз" : "Наверх",
            icon: props.layout.alignOf(item.id) === "start" ? "arrow-down" : "arrow-up",
            command: "ide.workbench.section.align",
            args: {
              section: item.id,
              align: props.layout.alignOf(item.id) === "start" ? "end" : "start",
            },
            run: () =>
              emit("command", "ide.workbench.section.align", {
                section: item.id,
                align: props.layout.alignOf(item.id) === "start" ? "end" : "start",
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
  overflow.close();
  if (item.command) emit("command", item.command);
  else emit("update:section", item.id);
}
function runPickerCommand(id: string) {
  picker.close();
  emit("command", id);
}
</script>

<template>
  <SidebarSectionPicker
    v-if="!vertical"
    :picker="picker"
    :label="label"
    :section="section"
    :ordered="ordered"
    :current="current"
    :other-badges="otherBadges"
    :refreshing="refreshing"
    :refresh-command="refreshCommand"
    :project-settings="projectSettings"
    @toggle="commands.run('ide.workbench.section.picker.toggle')"
    @choose="choose"
    @command="runPickerCommand"
  />
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
  <SidebarHiddenSections
    v-if="vertical"
    :overflow="overflow"
    :hidden-items="hiddenItems"
    :error="visibility.error.value"
    @choose="choose"
    @restore="
      (section) => commands.run('ide.workbench.section.visibility.set', { section, visible: true })
    "
  />
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
.side-tabs {
  display: flex;
  flex-shrink: 0;
}
.side-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
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
</style>
