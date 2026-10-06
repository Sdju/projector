<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import IconSettings from "~icons/lucide/settings-2";
import IconSearch from "~icons/lucide/search";
import IconClose from "~icons/lucide/x";
import UiButton from "../../common/ui/UiButton.vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import type { SettingsSection } from "./sections.ts";

const props = withDefaults(
  defineProps<{
    sections: SettingsSection[];
    selected: string;
    embedded?: boolean;
    /** Заголовок и подпись области; у настроек проекта свои. */
    title?: string;
    /** Идентификатор области команд: у одновременно открытых настроек он разный. */
    scope?: string;
  }>(),
  { title: "Настройки", scope: "settings" },
);
const emit = defineEmits<{ select: [id: string] }>();
const query = ref("");
const search = ref<HTMLInputElement>();
const sidebar = ref<HTMLElement>();
const content = ref<HTMLElement>();
const visited = ref(new Set<string>());
const filtered = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return props.sections.filter((section) => {
    const text =
      `${section.title} ${section.group} ${section.description} ${section.keywords}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
});
const groups = computed(() => [...new Set(filtered.value.map((section) => section.group))]);
const active = computed(
  () => filtered.value.find((section) => section.id === props.selected) ?? filtered.value[0],
);
watch(
  active,
  (section) => {
    if (section) visited.value.add(section.id);
    void nextTick(() => {
      content.value?.scrollTo({ top: 0 });
      const button = sidebar.value?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!button || !sidebar.value) return;
      const bounds = button.getBoundingClientRect();
      const container = sidebar.value.getBoundingClientRect();
      if (bounds.right > container.right)
        sidebar.value.scrollLeft += bounds.right - container.right;
      else if (bounds.left < container.left)
        sidebar.value.scrollLeft += bounds.left - container.left;
    });
  },
  { immediate: true },
);
const commands = useCommandScope(props.scope, () => ({
  surface: "settings",
  section: active.value?.id ?? "",
  query: query.value,
}));
commands.scope.registerCommand({
  id: "ide.settings.sections.list",
  palette: false,
  title: "Список разделов настроек",
  description: "Возвращает id, название, группу, описание и ключевые слова всех разделов настроек.",
  run: () =>
    props.sections.map(({ id, title, group, description, keywords }) => ({
      id,
      title,
      group,
      description,
      keywords,
    })),
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
    if (typeof id !== "string" || !props.sections.some((section) => section.id === id))
      throw new Error("Неизвестный раздел настроек");
    query.value = "";
    emit("select", id);
  },
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
function filter(event: Event) {
  commands.run("ide.settings.search", { query: (event.target as HTMLInputElement).value });
}
</script>

<template>
  <section
    class="settings-workbench"
    :class="{ embedded }"
    :aria-label="title"
    @pointerdown="commands.scope.activate()"
  >
    <header class="toolbar">
      <h1><IconSettings aria-hidden="true" />{{ title }}</h1>
      <div class="search">
        <IconSearch aria-hidden="true" />
        <input
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
          icon
          size="sm"
          aria-label="Очистить поиск"
          title="Очистить поиск"
          @click="commands.run('ide.settings.search', { query: '' })"
          ><IconClose
        /></UiButton>
      </div>
    </header>
    <div class="layout">
      <nav ref="sidebar" class="sidebar" aria-label="Разделы настроек">
        <div v-for="group in groups" :key="group" class="group">
          <h2>{{ group }}</h2>
          <button
            v-for="section in filtered.filter((item) => item.group === group)"
            :key="section.id"
            type="button"
            :aria-current="section.id === active?.id ? 'page' : undefined"
            :class="{ selected: section.id === active?.id }"
            @click="commands.run('ide.settings.section.open', { id: section.id })"
          >
            {{ section.title }}
          </button>
        </div>
        <p v-if="!filtered.length" class="no-results" role="status">Нет подходящих разделов</p>
      </nav>
      <div ref="content" class="content">
        <header v-if="active" class="section-heading">
          <h2>{{ active.title }}</h2>
          <p>{{ active.description }}</p>
        </header>
        <template v-for="section in sections" :key="section.id">
          <div
            v-if="visited.has(section.id)"
            v-show="section.id === active?.id"
            class="section-body"
          >
            <component :is="section.component" v-bind="section.props" />
          </div>
        </template>
        <div v-if="$slots.footer && active" class="footer"><slot name="footer" /></div>
        <div v-if="!active" class="empty">
          <IconSearch aria-hidden="true" />
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-2);
  border-bottom: 1px solid var(--line);
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
  display: flex;
  align-items: center;
  gap: var(--sp-2);
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
.layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 400px;
}
.sidebar {
  padding: var(--sp-2);
  background: var(--bg-2);
  border-right: 1px solid var(--line);
}
.group + .group {
  margin-top: var(--sp-3);
}
.group h2 {
  margin: var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 500;
}
.group button {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--control-h);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-sm);
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.group button:hover {
  background: var(--hover);
}
.group button.selected {
  background: var(--selection);
  color: var(--text);
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
  max-width: 800px;
}
.section-body :deep(input:not([type="checkbox"], [type="radio"])),
.section-body :deep(select) {
  min-height: var(--control-h);
  padding-block: var(--sp-1);
  font-size: var(--fs-sm);
}
.section-body :deep(.interface-settings),
.section-body :deep(.network-settings),
.section-body :deep(.editor-settings) {
  margin-bottom: 0;
}
.section-body :deep(.mode) {
  padding-block: var(--sp-2);
}
.section-body :deep(.hint),
.section-body :deep(.muted) {
  font-size: var(--fs-xs);
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
.no-results {
  color: var(--muted);
  font-size: var(--fs-xs);
  margin: var(--sp-2);
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
  .toolbar {
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .search {
    width: 100%;
  }
  .search input {
    font-size: var(--fs-input);
  }
  .layout {
    display: block;
    min-height: 0;
  }
  .sidebar {
    display: flex;
    gap: var(--sp-2);
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .group {
    display: flex;
    gap: var(--sp-1);
    flex-shrink: 0;
  }
  .group + .group {
    margin-top: 0;
  }
  .group h2 {
    display: none;
  }
  .group button {
    width: auto;
    white-space: nowrap;
  }
  .content {
    padding: var(--sp-4);
  }
  .section-heading {
    margin-bottom: var(--sp-4);
  }
  .section-body :deep(input:not([type="checkbox"], [type="radio"])),
  .section-body :deep(select) {
    font-size: var(--fs-input);
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
  .sidebar {
    display: flex;
    gap: var(--sp-2);
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .group {
    display: flex;
    gap: var(--sp-1);
    flex-shrink: 0;
  }
  .group + .group {
    margin-top: 0;
  }
  .group h2 {
    display: none;
  }
  .group button {
    width: auto;
    white-space: nowrap;
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
