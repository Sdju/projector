<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiToolbar from "../../common/ui/UiToolbar.vue";
import UiControl, { type UiControlHandle } from "../../common/ui/UiControl.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiControlScope from "../../common/ui/UiControlScope.vue";
import { computed, nextTick, ref, watch } from "vue";
import { useIslandMenu } from "../../common/utilities/island-menu.ts";
import UiButton from "../../common/ui/UiButton.vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import { useTabReadout, type TabReadout } from "../../common/utilities/tab-readout.ts";
import type { SettingsReadoutState, SettingsSection } from "./sections.ts";
import {
  filterSettingsSections,
  listSettingsSections,
  settingsPageItems,
  settingsPageOf,
} from "./query.ts";
import SettingsNavigationMenu from "./SettingsNavigationMenu.vue";
import SettingsSidebar from "./SettingsSidebar.vue";
import SettingsPagesIndex from "./SettingsPagesIndex.vue";

const props = withDefaults(
  defineProps<{
    sections: SettingsSection[];
    selected: string;
    embedded?: boolean;
    /** Заголовок и подпись области; у настроек проекта свои. */
    title?: string;
    /** Идентификатор области команд: у одновременно открытых настроек он разный. */
    scope?: string;
    /** Что штатный агент видит во вкладке настроек: собирает владелец вкладки. */
    read?: (state: SettingsReadoutState) => TabReadout;
  }>(),
  { title: "Настройки", scope: "settings" },
);
const emit = defineEmits<{ select: [id: string] }>();
const query = ref("");
const search = ref<UiControlHandle>();
const sidebar = ref<InstanceType<typeof SettingsSidebar>>();
const menu = useIslandMenu({
  anchor: "left",
  initialFocus: ['[aria-current="page"]', "button"],
  items: "button",
});
const content = ref<HTMLElement>();
const visited = ref(new Set<string>());
const filtered = computed(() => filterSettingsSections(props.sections, query.value));
const groupedSections = computed(() => {
  const groups = [...new Set(filtered.value.map((section) => section.group))];
  return groups.map((group) => ({
    group,
    sections: filtered.value.filter((section) => section.group === group),
  }));
});
/** The section that owns the selected page, or the first one when nothing matches. */
const active = computed(
  () =>
    filtered.value.find(
      (section) =>
        section.id === props.selected || section.items?.some((item) => item.id === props.selected),
    ) ?? filtered.value[0],
);
const page = computed(() => settingsPageOf(active.value, props.selected));
const heading = computed(() => {
  const section = active.value;
  const item = page.value?.item;
  if (!section) return;
  return {
    title: item?.title ?? section.title,
    description: item?.description ?? section.description,
  };
});
// Владелец вкладки решает, что попадёт в снапшот; сам workbench отдаёт текущий раздел и поиск.
useTabReadout(() =>
  props.read?.({
    section: page.value?.item?.id ?? active.value?.id ?? "",
    sectionTitle: heading.value?.title ?? "",
    query: query.value,
    visible: filtered.value.length,
  }),
);
watch(
  [active, page],
  ([section, current]) => {
    if (current?.item) visited.value.add(current.item.id);
    else if (section?.component) visited.value.add(section.id);
    void nextTick(() => {
      content.value?.scrollTo({ top: 0 });
      sidebar.value?.revealSelection();
    });
  },
  { immediate: true },
);
const commands = useCommandScope(props.scope, () => ({
  surface: "settings",
  section: props.selected || active.value?.id || "",
  query: query.value,
}));
commands.scope.registerCommand({
  id: "ide.settings.sections.list",
  palette: false,
  title: "Список разделов настроек",
  description:
    "Возвращает id, название, группу, описание и ключевые слова разделов и вложенных страниц с собственной формой.",
  run: () => listSettingsSections(props.sections),
});
commands.scope.registerCommand({
  id: "ide.settings.section.open",
  palette: false,
  title: "Открыть раздел настроек",
  description:
    "Открывает раздел настроек по id. Сохраняет незавершённые формы других разделов в текущей странице.",
  arguments: { id: "string: идентификатор раздела настроек" },
  run: (value) => {
    const { id } = commandArgs(value);
    const known = props.sections.some(
      (section) => section.id === id || section.items?.some((item) => item.id === id),
    );
    if (typeof id !== "string" || !known) throw new Error("Неизвестный раздел настроек");
    query.value = "";
    emit("select", id);
    menu.close();
  },
});
commands.scope.registerCommand({
  id: "ide.settings.navigation.toggle",
  title: "Выбрать раздел настроек",
  description: "Открывает или закрывает список разделов настроек на узком экране.",
  run: () => menu.toggle(),
});
commands.scope.registerCommand({
  id: "ide.settings.search",
  title: "Поиск настроек",
  description: "Фильтрует разделы по названию, описанию и параметрам; без query фокусирует поиск.",
  arguments: { query: "string: поисковый запрос, пустая строка сбрасывает фильтр" },
  run: (value) => {
    const args = commandArgs(value);
    if (args.query !== undefined && typeof args.query !== "string")
      throw new Error("query должен быть строкой");
    if (typeof args.query === "string") query.value = args.query;
    else search.value?.focus();
  },
});
function selectSection(id: string) {
  commands.run("ide.settings.section.open", { id });
}
function filter(event: Event) {
  commands.run("ide.settings.search", { query: (event.target as HTMLInputElement).value });
}
</script>

<template>
  <section
    class="settings-workbench"
    :class="{ embedded, 'theme-panel': !embedded }"
    :aria-label="title"
    @pointerdown="commands.scope.activate()"
  >
    <UiToolbar as="header" class="toolbar" :gap="4" justify="between">
      <h1><ProjectorIcon name="settings-2" aria-hidden="true" />{{ title }}</h1>
      <UiInline class="search" justify="normal">
        <ProjectorIcon name="search" aria-hidden="true" />
        <UiControl
          ref="search"
          :value="query"
          type="search"
          placeholder="Поиск настроек…"
          aria-label="Поиск настроек"
          @input="filter"
          @keydown.esc.prevent="commands.run('ide.settings.search', { query: '' })"
        />
        <UiButton
          v-if="query"
          shape="icon"
          size="sm"
          aria-label="Очистить поиск"
          title="Очистить поиск"
          @click="commands.run('ide.settings.search', { query: '' })"
          ><ProjectorIcon name="x"
        /></UiButton>
      </UiInline>
    </UiToolbar>
    <div class="mobile-navigation">
      <button
        :ref="(element) => (menu.trigger.value = element as HTMLElement | undefined)"
        type="button"
        class="navigation-trigger"
        :aria-expanded="menu.open.value"
        :aria-controls="menu.id"
        @click="commands.run('ide.settings.navigation.toggle')"
      >
        <span
          ><small>Раздел настроек</small
          ><strong>{{ heading?.title ?? "Выбрать раздел" }}</strong></span
        >
        <ProjectorIcon name="chevron-down" aria-hidden="true" />
      </button>
    </div>
    <SettingsNavigationMenu
      :menu="menu"
      :groups="groupedSections"
      :selected="selected"
      @select="selectSection"
    />
    <div class="layout">
      <SettingsSidebar
        ref="sidebar"
        class="sidebar"
        :groups="groupedSections"
        :selected="selected"
        @select="selectSection"
      />
      <div ref="content" class="content">
        <header v-if="heading" class="section-heading">
          <h2>{{ heading.title }}</h2>
          <p>{{ heading.description }}</p>
        </header>
        <template v-for="section in sections" :key="section.id">
          <UiControlScope
            v-if="section.component && visited.has(section.id)"
            v-show="page?.key === section.id"
            density="compact"
            class="section-body"
          >
            <component :is="section.component" v-bind="section.props" />
          </UiControlScope>
          <template v-for="item in settingsPageItems(section)" :key="item.id">
            <UiControlScope
              v-if="visited.has(item.id)"
              v-show="page?.key === item.id"
              density="compact"
              class="section-body"
            >
              <component :is="item.component" v-bind="item.props" />
            </UiControlScope>
          </template>
        </template>
        <SettingsPagesIndex
          v-if="active && page && !page.item && !active.component"
          class="section-body"
          :pages="settingsPageItems(active)"
          @open="commands.run('ide.settings.section.open', { id: $event })"
        />
        <div v-if="$slots.footer && active" class="footer"><slot name="footer" /></div>
        <div v-if="!active" class="empty">
          <ProjectorIcon name="search" aria-hidden="true" />
          <p>Настройки не найдены</p>
          <span>Попробуйте другое название или параметр.</span>
          <UiButton @click="commands.run('ide.settings.search', { query: '' })"
            >Сбросить поиск</UiButton
          >
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-workbench {
  container-type: inline-size;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  font-size: var(--fs-sm);
}
[data-theme-effects] .settings-workbench {
  position: relative;
}
.settings-workbench.embedded {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 0;
  border-radius: 0;
}
.embedded .toolbar {
  flex-shrink: 0;
}
.embedded .layout {
  flex: 1;
  height: auto;
  min-height: 0;
}
.embedded .sidebar,
.embedded .content {
  min-height: 0;
  overflow-y: auto;
}
.embedded .content {
  display: flex;
  flex-direction: column;
}
.embedded .section-body {
  width: 100%;
}
.toolbar {
  background: var(--theme-chrome, var(--bg-2));
}
h1 {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 500;
}
svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--muted);
}
.search {
  width: min(100%, 300px);
  padding-left: var(--sp-2);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.search:focus-within {
  border-color: var(--focus);
}
.search input {
  min-width: 0;
  min-height: var(--control-h-sm);
  border: 0;
  padding: var(--sp-1);
  font-size: var(--fs-xs);
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.mobile-navigation {
  display: none;
}
.navigation-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
}
.navigation-trigger span {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.navigation-trigger small {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.navigation-trigger strong {
  font-size: var(--fs-xs);
  font-weight: 500;
}
.layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 400px;
}
.content {
  min-width: 0;
  padding: var(--sp-5);
}
.section-heading {
  margin-bottom: var(--sp-4);
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.section-heading h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-md);
  font-weight: 500;
}
.section-heading p {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.section-body {
  --ui-choice-space: var(--sp-2);
  --ui-hint-font-size: var(--fs-xs);
  --ui-section-margin: 0px;
  max-width: 800px;
}
/* Панель действий (например, «Сохранить») закреплена внизу прокручиваемого содержимого */
.footer {
  position: sticky;
  bottom: calc(var(--sp-5) * -1);
  margin: auto calc(var(--sp-5) * -1) calc(var(--sp-5) * -1);
  padding: var(--sp-3) var(--sp-5);
  border-top: 1px solid var(--line);
  background: var(--bg-2);
  z-index: var(--z-sticky);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-6) 0;
  text-align: center;
}
.empty p {
  margin: 0;
}
.empty span {
  color: var(--muted);
  font-size: var(--fs-xs);
}
@media (min-width: 701px) {
  .layout {
    height: calc(100dvh - 130px);
  }
  .sidebar,
  .content {
    overflow-y: auto;
  }
}
@media (max-width: 700px) {
  .search input {
    font-size: var(--fs-input);
  }
}
@container (max-width: 650px) {
  .toolbar {
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .search {
    width: 100%;
  }
  .layout {
    display: block;
    min-height: 0;
  }
  .mobile-navigation {
    display: block;
    background: var(--theme-chrome, var(--bg-2));
    border-bottom: 1px solid var(--line);
  }
  .sidebar {
    display: none;
  }
  .content {
    padding: var(--sp-4);
  }
  .section-heading {
    margin-bottom: var(--sp-4);
  }
  .embedded .layout {
    display: flex;
    flex-direction: column;
  }
  .embedded .sidebar {
    flex-shrink: 0;
    overflow-y: hidden;
  }
  .embedded .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}
</style>
