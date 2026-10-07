<script setup lang="ts">
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { layoutPresets, type LayoutPreset } from "../lib/workbench-layout.ts";
import IconLayout from "~icons/lucide/layout-template";
import IconEye from "~icons/lucide/eye";
import IconEyeOff from "~icons/lucide/eye-off";
import IconSidebar from "~icons/lucide/panel-left";
import IconReset from "~icons/lucide/rotate-ccw";

/**
 * Остров управления раскладкой: наглядные готовые варианты, видимость блоков и сброс.
 * Рамка охватывает кнопку, как у переключателя проекта; остров рисуется поверх (Teleport).
 */
const props = defineProps<{
  groups: { id: string; role?: string; label: string; hidden: boolean }[];
  preset?: LayoutPreset;
  presetsAvailable: boolean;
  sidebarHidden: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const titles: Record<LayoutPreset, { title: string; caption: string }> = {
  side: { title: "Рядом", caption: "Редактор и терминалы" },
  stacked: { title: "Снизу", caption: "Терминалы под редактором" },
  editor: { title: "Редактор", caption: "Только файлы" },
  terminal: { title: "Терминалы", caption: "Только сессии" },
};
const roleTitles: Record<string, string> = { editor: "Редактор", terminal: "Терминалы" };
const menu = useIslandMenu({
  anchor: "right",
  initialFocus: [".preset.active", ".preset", ".block"],
  horizontalArrows: true,
});
const { open, toggle, close } = menu;
const shownBlocks = computed(() => props.groups.filter((group) => group.role));

function run(id: string, args?: unknown, keepOpen = false) {
  emit("command", id, args);
  if (!keepOpen) close();
}
</script>

<template>
  <span :ref="menu.trigger" class="layout-trigger">
    <UiButton
      icon
      size="sm"
      title="Раскладка"
      aria-label="Раскладка"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menu.id : undefined"
      @click="toggle()"
    >
      <IconLayout aria-hidden="true" />
    </UiButton>
  </span>
  <UiIsland :menu="menu" label="Управление раскладкой" gap="var(--sp-2)">
    <button class="island-head" aria-label="Закрыть" @click="toggle(false)">
      <span>Раскладка</span><IconLayout aria-hidden="true" />
    </button>
    <div v-if="presetsAvailable" class="presets" role="group" aria-label="Готовые раскладки">
      <button
        v-for="name in layoutPresets"
        :key="name"
        class="preset"
        :class="{ active: preset === name }"
        :aria-pressed="preset === name"
        data-command="ide.workbench.layout.preset"
        @click="run('ide.workbench.layout.preset', { preset: name })"
      >
        <span class="diagram" :class="`is-${name}`" aria-hidden="true">
          <i class="side" />
          <span class="stage">
            <i v-if="name !== 'terminal'" class="editor" />
            <i v-if="name !== 'editor'" class="terminal" />
          </span>
        </span>
        <span class="name">{{ titles[name].title }}</span>
        <span class="caption">{{ titles[name].caption }}</span>
      </button>
    </div>
    <div class="blocks" role="group" aria-label="Блоки">
      <button
        class="block"
        :class="{ off: sidebarHidden }"
        :aria-pressed="!sidebarHidden"
        data-command="ide.workbench.sidebar.toggle"
        @click="run('ide.workbench.sidebar.toggle', undefined, true)"
      >
        <IconSidebar aria-hidden="true" />
        <span class="copy">
          <span class="name">Боковая панель</span>
          <span class="caption">{{ sidebarHidden ? "скрыта" : "показана" }}</span>
        </span>
      </button>
      <button
        v-for="group in shownBlocks"
        :key="group.id"
        class="block"
        :class="{ off: group.hidden }"
        :aria-pressed="!group.hidden"
        data-command="ide.workbench.layout.group.toggle"
        @click="run('ide.workbench.layout.group.toggle', { group: group.id }, true)"
      >
        <component :is="group.hidden ? IconEyeOff : IconEye" aria-hidden="true" />
        <span class="copy">
          <span class="name">{{ roleTitles[group.role!] ?? group.label }}</span>
          <span class="caption">{{
            group.hidden
              ? "скрыт"
              : group.label === roleTitles[group.role!]
                ? "показан"
                : group.label
          }}</span>
        </span>
      </button>
    </div>
    <button
      class="reset"
      data-command="ide.workbench.layout.reset"
      @click="run('ide.workbench.layout.reset')"
    >
      <IconReset aria-hidden="true" />Сбросить раскладку
    </button>
  </UiIsland>
</template>

<style scoped>
.layout-trigger {
  display: inline-flex;
  flex-shrink: 0;
}
/* Шапка стоит на месте кнопки: остров выглядит выросшей из неё рамкой */
.island-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--control-h-sm);
  padding-inline: var(--sp-2) 7px;
  border-radius: var(--r-md);
  color: var(--text);
}
.island-head svg {
  width: 14px;
  height: 14px;
}
.presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2);
  padding-inline: var(--sp-1);
}
.preset {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  text-align: left;
}
.preset:hover,
.preset:focus-visible {
  background: var(--hover);
  outline: none;
}
.preset.active {
  border-color: var(--focus);
  background: var(--active);
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
/* Схема окна: боковая панель слева, редактор и терминалы по раскладке */
.diagram {
  display: flex;
  gap: 3px;
  height: 44px;
  margin-bottom: var(--sp-1);
  padding: 3px;
  border-radius: var(--r-sm);
  background: var(--canvas);
}
.diagram i {
  display: block;
  border-radius: 2px;
  background: var(--bg-4);
}
.diagram .side {
  flex: none;
  width: 10px;
  background: var(--bg-3);
}
.diagram .stage {
  display: flex;
  flex: 1;
  gap: 3px;
}
.diagram .stage i {
  flex: 1;
}
.diagram .terminal {
  background: color-mix(in srgb, var(--accent) 45%, var(--bg-3));
}
.is-side .editor {
  flex: 1.8;
}
.is-side .terminal {
  flex: 1;
}
.is-stacked .stage {
  flex-direction: column;
}
.is-stacked .editor {
  flex: 1.8;
}
.blocks {
  display: flex;
  flex-direction: column;
}
.block {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 6px var(--sp-2);
  border-radius: var(--r-md);
  text-align: left;
}
.block:hover,
.block:focus-visible {
  background: var(--active);
  outline: none;
}
.block svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.block.off {
  color: var(--muted);
}
.copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.reset {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0 var(--sp-1) var(--sp-1);
  padding: 6px var(--sp-2);
  border-top: 1px solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted);
}
.reset:hover,
.reset:focus-visible {
  background: var(--active);
  color: var(--text);
  outline: none;
}
.reset svg {
  width: 14px;
  height: 14px;
}
</style>
