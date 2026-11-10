<script setup lang="ts">
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import { computed, ref, type Component } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import IconRefresh from "~icons/lucide/rotate-cw";
import IconProjectSettings from "~icons/lucide/sliders-horizontal";
import IconChevron from "~icons/lucide/chevron-down";
import IconCheck from "~icons/lucide/check";
import IconX from "~icons/lucide/x";
import { groupSidebar } from "../../workspace-api/index.ts";

export interface SidebarItem {
  id: string;
  title: string;
  icon: Component;
  badge: number;
  command?: string;
  /** Родительский раздел: иконка стоит рядом с ним в общей подложке. */
  group?: string;
  /** Вид раздела, по которому берутся компонент и подписи. */
  kind?: string;
  /** Временный раздел можно закрыть. */
  closable?: boolean;
}
const props = defineProps<{
  section: string;
  items: SidebarItem[];
  /** Вертикальная полоса-остров слева от панели; без неё — горизонтальные вкладки (мобильный вид). */
  vertical?: boolean;
  /** Панель раздела свёрнута: активный раздел не подсвечивается. */
  collapsed?: boolean;
  /** У проекта есть свои настройки: кнопка стоит на полосе разделов. */
  projectSettings?: boolean;
  /** Название полосы разделов для экранных дикторов. */
  label?: string;
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
const groups = computed(() => groupSidebar(props.items));
const ordered = computed(() => groups.value.flat());
const current = computed(() => ordered.value.find((item) => item.id === props.section));
const otherBadges = computed(() =>
  ordered.value.some((item) => item.id !== props.section && item.badge),
);
const commands = useCommandScope("sidebar-sections", () => ({ surface: "workbench" }));
commands.scope.registerCommand({
  id: "ide.workbench.section.picker.toggle",
  title: "Открыть или закрыть выбор раздела",
  description:
    "Показывает список разделов проекта (файлы, поиск, Git и другие) в мобильной боковой панели.",
  enabled: () => !props.vertical,
  run: () => void picker.toggle(),
});
const sectionMenu = ref<InstanceType<typeof ContextMenu>>();
const menuTarget = ref<SidebarItem>();
const menuItems = computed<ContextMenuItem[]>(() => {
  const item = menuTarget.value;
  if (!item) return [];
  return [
    {
      id: "section.close",
      label: `Закрыть «${item.title}»`,
      icon: IconX,
      command: "ide.workbench.section.close",
      args: { section: item.id },
      run: () => emit("command", "ide.workbench.section.close", { section: item.id }),
    },
  ];
});
function openSectionMenu(event: MouseEvent, item: SidebarItem) {
  if (!props.vertical || !item.closable) return;
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
        <component :is="current?.icon" v-if="current" aria-hidden="true" />
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
        <IconChevron class="chevron" aria-hidden="true" />
      </button>
    </span>
    <div class="side-actions">
      <UiButton
        shape="icon"
        size="sm"
        title="Обновить раздел"
        aria-label="Обновить раздел"
        data-command="ide.workbench.sidebar.refresh"
        @click="emit('command', 'ide.workbench.sidebar.refresh')"
      >
        <IconRefresh aria-hidden="true" />
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
      <component :is="item.icon" :class="{ 'git-logo': item.id === 'git' }" aria-hidden="true" />
      <span class="label">{{ item.title }}</span>
      <span v-if="item.badge" class="count" aria-hidden="true">{{ item.badge }}</span>
      <IconCheck v-if="section === item.id" class="check" aria-hidden="true" />
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
      <IconProjectSettings aria-hidden="true" />
      <span class="label">Настройки проекта</span>
    </button>
  </UiIsland>
  <nav v-else class="side-tabs vertical" :aria-label="label ?? 'Разделы проекта'">
    <div
      v-for="group in groups"
      :key="group[0]?.id"
      class="side-group"
      :class="{ grouped: group.length > 1 }"
    >
      <template v-for="(item, index) in group" :key="item.id">
        <i v-if="index" class="side-separator" aria-hidden="true" />
        <button
          :class="{ selected: section === item.id && !collapsed }"
          :aria-pressed="section === item.id && !collapsed"
          :title="item.closable ? `${item.title} · ПКМ: закрыть` : item.title"
          :aria-label="item.badge ? `${item.title}: ${item.badge}` : item.title"
          :aria-haspopup="item.closable ? 'menu' : undefined"
          @click="item.command ? emit('command', item.command) : emit('update:section', item.id)"
          @contextmenu="openSectionMenu($event, item)"
        >
          <component
            :is="item.icon"
            :class="{ 'git-logo': item.id === 'git' }"
            aria-hidden="true"
          />
          <span v-if="item.badge" aria-hidden="true">{{ item.badge }}</span>
        </button>
      </template>
    </div>
    <div v-if="projectSettings" class="side-actions">
      <UiButton
        shape="icon"
        size="sm"
        title="Настройки проекта"
        aria-label="Настройки проекта"
        data-command="ide.workbench.project.settings.open"
        @click="emit('command', 'ide.workbench.project.settings.open')"
      >
        <IconProjectSettings aria-hidden="true" />
      </UiButton>
    </div>
  </nav>
  <ContextMenu ref="sectionMenu" :items="menuItems" label="Действия раздела" />
</template>

<style scoped>
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
