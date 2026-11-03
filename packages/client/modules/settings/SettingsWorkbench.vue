<script setup lang="ts">
import UiToolbar from "../../common/ui/UiToolbar.vue";
import UiControl, { type UiControlHandle } from "../../common/ui/UiControl.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiControlScope from "../../common/ui/UiControlScope.vue";
import { computed, nextTick, ref, watch } from "vue";
import IconSettings from "~icons/lucide/settings-2";
import IconSearch from "~icons/lucide/search";
import IconClose from "~icons/lucide/x";
import UiButton from "../../common/ui/UiButton.vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import { useTabReadout, type TabReadout } from "../../common/utilities/tab-readout.ts";
import type { SettingsReadoutState, SettingsSection } from "./sections.ts";

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
/** The section that owns the selected page, or the first one when nothing matches. */
const active = computed(
  () =>
    filtered.value.find(
      (section) =>
        section.id === props.selected || section.items?.some((item) => item.id === props.selected),
    ) ?? filtered.value[0],
);
// Владелец вкладки решает, что попадёт в снапшот; сам workbench отдаёт текущий раздел и поиск.
useTabReadout(() =>
  props.read?.({
    section: active.value?.id ?? "",
    sectionTitle: active.value?.title ?? "",
    query: query.value,
    visible: filtered.value.length,
  }),
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
/* Reordering nested items by dragging them, or with Alt + arrows from the keyboard. */
const itemDrag = ref("");
const itemTarget = ref("");
const itemAfter = ref(false);
function itemDragStart(event: DragEvent, id: string) {
  itemDrag.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}
function itemDragEnd() {
  itemDrag.value = "";
  itemTarget.value = "";
}
/** The row under the pointer, or the nearest one above it; gaps between rows take drops too. */
function rowAt(list: HTMLElement, clientY: number): { id: string; after: boolean } | undefined {
  let hit: { id: string; after: boolean } | undefined;
  for (const row of list.querySelectorAll<HTMLElement>(":scope > li")) {
    const bounds = row.getBoundingClientRect();
    const id = row.dataset.id ?? "";
    if (clientY < bounds.top) return hit ?? { id, after: false };
    hit = { id, after: clientY > bounds.top + bounds.height / 2 };
  }
  return hit;
}
function listDragOver(event: DragEvent, section: SettingsSection) {
  if (!itemDrag.value || !section.reorder) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const hit = rowAt(event.currentTarget as HTMLElement, event.clientY);
  itemTarget.value = hit && hit.id !== itemDrag.value ? hit.id : "";
  itemAfter.value = hit?.after ?? false;
}
function listDrop(event: DragEvent, section: SettingsSection) {
  if (!itemDrag.value || !section.reorder || !section.items) return;
  event.preventDefault();
  const hit = rowAt(event.currentTarget as HTMLElement, event.clientY);
  const dragged = itemDrag.value;
  itemDragEnd();
  if (!hit || hit.id === dragged) return;
  const ids = section.items.map((item) => item.id).filter((key) => key !== dragged);
  const at = ids.indexOf(hit.id);
  if (at < 0) return;
  ids.splice(at + (hit.after ? 1 : 0), 0, dragged);
  section.reorder(ids);
}
function itemKey(event: KeyboardEvent, section: SettingsSection, index: number) {
  if (!event.altKey || !section.reorder || !section.items) return;
  const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1;
  const ids = section.items.map((item) => item.id);
  if (to < 0 || to >= ids.length) return;
  event.preventDefault();
  [ids[index], ids[to]] = [ids[to]!, ids[index]!];
  section.reorder(ids);
}

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
    const known = props.sections.some(
      (section) => section.id === id || section.items?.some((item) => item.id === id),
    );
    if (typeof id !== "string" || !known) throw new Error("Неизвестный раздел настроек");
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
    <UiToolbar as="header" class="toolbar" :gap="4" justify="between">
      <h1><IconSettings aria-hidden="true" />{{ title }}</h1>
      <UiInline class="search" justify="normal">
        <IconSearch aria-hidden="true" />
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
          ><IconClose
        /></UiButton>
      </UiInline>
    </UiToolbar>
    <div class="layout">
      <nav ref="sidebar" class="sidebar" aria-label="Разделы настроек">
        <div v-for="group in groups" :key="group" class="group">
          <h2>{{ group }}</h2>
          <template
            v-for="section in filtered.filter((item) => item.group === group)"
            :key="section.id"
          >
            <button
              type="button"
              :aria-current="section.id === selected ? 'page' : undefined"
              :class="{ selected: section.id === selected }"
              @click="commands.run('ide.settings.section.open', { id: section.id })"
            >
              {{ section.title }}
            </button>
            <ul
              v-if="section.items?.length"
              class="items"
              @dragover="listDragOver($event, section)"
              @drop="listDrop($event, section)"
            >
              <li
                v-for="(item, at) in section.items"
                :key="item.id"
                :data-id="item.id"
                :draggable="!!section.reorder"
                :class="{
                  dragging: itemDrag === item.id,
                  'drop-before': itemTarget === item.id && !itemAfter,
                  'drop-after': itemTarget === item.id && itemAfter,
                }"
                @dragstart="itemDragStart($event, item.id)"
                @dragend="itemDragEnd"
              >
                <button
                  type="button"
                  :aria-current="item.id === selected ? 'page' : undefined"
                  :class="{ selected: item.id === selected, problem: item.problem }"
                  @click="commands.run('ide.settings.section.open', { id: item.id })"
                  @keydown="itemKey($event, section, at)"
                >
                  <span class="item-title">{{ item.title }}</span>
                  <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
                </button>
              </li>
            </ul>
          </template>
        </div>
        <p v-if="!filtered.length" class="no-results" role="status">Нет подходящих разделов</p>
      </nav>
      <div ref="content" class="content">
        <header v-if="active" class="section-heading">
          <h2>{{ active.title }}</h2>
          <p>{{ active.description }}</p>
        </header>
        <template v-for="section in sections" :key="section.id">
          <UiControlScope
            density="compact"
            v-if="visited.has(section.id)"
            v-show="section.id === active?.id"
            class="section-body"
          >
            <component :is="section.component" v-bind="section.props" />
          </UiControlScope>
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
  background: var(--bg-2);
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
.items {
  display: grid;
  gap: 1px;
  margin: 0 0 var(--sp-1) var(--sp-3);
  padding: 0 0 0 var(--sp-2);
  border-left: 1px solid var(--line);
  list-style: none;
}
.items button {
  min-height: 26px;
  font-size: var(--fs-xs);
}
.item-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-hint {
  margin-left: auto;
  padding-left: var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.items li {
  position: relative;
}
.items li.dragging {
  opacity: 0.45;
}
.items li.drop-before::before,
.items li.drop-after::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--focus);
  pointer-events: none;
}
.items li.drop-before::before {
  top: -1px;
}
.items li.drop-after::after {
  bottom: -1px;
}
.items button.problem .item-title::after {
  content: " •";
  color: var(--err);
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
