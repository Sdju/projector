<script setup lang="ts">
import { computed, useId } from "vue";
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiEmpty from "../../common/ui/UiEmpty.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import type { PluginCatalog, PluginInfo } from "./client.ts";
import {
  pluginNeedsTrust,
  pluginRowCaption,
  pluginRowIcon,
  visiblePluginKindFilters,
  visibleThemeModeFilters,
  type PluginKindFilter,
  type ThemeModeFilter,
} from "./kinds.ts";
import PluginSettingsGroup from "./PluginSettingsGroup.vue";

const props = defineProps<{
  catalog: PluginCatalog;
  filtered: PluginInfo[];
  summary: { total: number; enabled: number; trust: number; issues: number };
  query: string;
  kind: PluginKindFilter;
  mode: ThemeModeFilter;
  installPath: string;
  busy: boolean;
  error: string;
  status: string;
  commands: { run: (id: string, args?: unknown) => void };
}>();
const emit = defineEmits<{
  "update:query": [value: string];
  "update:installPath": [value: string];
}>();
const searchId = useId();
const pathId = useId();
const kindFilters = computed(() => visiblePluginKindFilters(props.catalog.plugins, props.kind));
const modeFilters = computed(() => visibleThemeModeFilters(props.catalog.plugins, props.kind));

function canToggle(plugin: PluginInfo) {
  return plugin.status === "enabled" || plugin.status === "disabled";
}

function setEnabled(plugin: PluginInfo, enabled: boolean) {
  props.commands.run(enabled ? "ide.plugin.enable" : "ide.plugin.disable", { id: plugin.id });
}
</script>

<template>
  <div class="catalog">
    <PluginSettingsGroup
      icon="puzzle"
      title="Установленные"
      :hint="
        summary.total
          ? `${summary.enabled} включено · ${summary.trust} ждут доверия · ${summary.issues} с ошибкой`
          : 'Пакеты с темами, агентами и доверенным кодом на этой машине.'
      "
    >
      <template #actions>
        <UiButton :disabled="busy" @click="commands.run('ide.plugins.refresh')">
          <ProjectorIcon name="refresh-cw" aria-hidden="true" />Обновить
        </UiButton>
      </template>

      <div class="filters">
        <UiControl
          :id="searchId"
          class="search-field"
          :model-value="query"
          type="search"
          placeholder="Найти плагин"
          aria-label="Поиск плагинов"
          :disabled="busy"
          @update:model-value="emit('update:query', String($event))"
        />
        <div v-if="kindFilters.length" class="kind-filters" role="group" aria-label="Вид вклада">
          <button
            v-for="item in kindFilters"
            :key="item.id"
            type="button"
            :aria-pressed="kind === item.id"
            :class="{ active: kind === item.id }"
            :disabled="busy"
            @click="commands.run('ide.plugins.filter', { kind: item.id })"
          >
            {{ item.title }}
          </button>
        </div>
        <div v-if="modeFilters.length" class="kind-filters" role="group" aria-label="Режим темы">
          <button
            v-for="item in modeFilters"
            :key="item.id"
            type="button"
            :aria-pressed="mode === item.id"
            :class="{ active: mode === item.id }"
            :disabled="busy"
            @click="commands.run('ide.plugins.filter', { mode: item.id })"
          >
            {{ item.title }}
          </button>
        </div>
      </div>

      <UiEmpty v-if="!catalog.plugins.length">
        Плагины не установлены. Выберите локальную папку с манифестом Projector.
      </UiEmpty>
      <UiEmpty v-else-if="!filtered.length">
        По текущему поиску и фильтру плагины не найдены.
      </UiEmpty>

      <ul v-if="filtered.length" class="plugin-list" aria-label="Установленные плагины">
        <li v-for="plugin in filtered" :key="plugin.id">
          <article
            class="plugin-row"
            :class="{ problem: plugin.status === 'error' || plugin.status === 'missing' }"
          >
            <button
              type="button"
              class="plugin-open"
              @click="commands.run('ide.plugin.open', { id: plugin.id })"
            >
              <span class="row-icon"
                ><ProjectorIcon :name="pluginRowIcon(plugin)" aria-hidden="true"
              /></span>
              <span class="row-copy">
                <strong>{{ plugin.id }}</strong>
                <span>{{ pluginRowCaption(plugin) }}</span>
              </span>
            </button>
            <UiButton
              v-if="pluginNeedsTrust(plugin)"
              size="sm"
              appearance="solid"
              :disabled="busy"
              @click="commands.run('ide.plugin.trust', { id: plugin.id })"
              >Доверие</UiButton
            >
            <label v-else-if="canToggle(plugin)" class="switch">
              <UiControl
                type="checkbox"
                :model-value="plugin.enabled"
                :disabled="busy"
                :aria-label="plugin.enabled ? 'Выключить плагин' : 'Включить плагин'"
                @update:model-value="setEnabled(plugin, !!$event)"
              />
              <span aria-hidden="true" />
            </label>
          </article>
        </li>
      </ul>
    </PluginSettingsGroup>

    <PluginSettingsGroup
      icon="folder-open"
      title="Установка"
      hint="Только локальная папка: Projector проверяет манифест и копирует пакет."
    >
      <div class="dropzone">
        <span class="drop-icon"><ProjectorIcon name="folder-open" aria-hidden="true" /></span>
        <div>
          <strong>Локальный плагин</strong>
          <p>Без архива и установки зависимостей хоста. Код агента и браузера ждёт доверия.</p>
        </div>
        <UiButton
          appearance="solid"
          :disabled="busy"
          @click="commands.run('ide.plugins.folder.open')"
          >Установить из папки</UiButton
        >
      </div>
      <form class="install-form" @submit.prevent="commands.run('ide.plugins.install')">
        <UiLabel :for="pathId" size="sm">Или укажите путь к локальной папке</UiLabel>
        <UiInline align="stretch" wrap>
          <UiControl
            :id="pathId"
            :model-value="installPath"
            grow
            mono
            placeholder="/path/to/theme-plugin"
            :disabled="busy"
            @update:model-value="emit('update:installPath', String($event))"
          />
          <UiButton type="submit" :disabled="busy || !installPath.trim()">Установить</UiButton>
          <UiButton
            type="button"
            :disabled="busy || !installPath.trim()"
            @click="commands.run('ide.plugins.rebuild', { path: installPath.trim() })"
            >Собрать и подключить</UiButton
          >
        </UiInline>
      </form>
      <p class="rebuild-hint">
        «Собрать и подключить» выполнит <code>projector.build</code> в папке и сразу включит
        результат с доверием.
      </p>
    </PluginSettingsGroup>

    <UiMessage v-if="error || status" role="status" :tone="error ? 'danger' : undefined">
      {{ error || status }}
    </UiMessage>
    <p class="directory">Локальный каталог: <code>{{ catalog.directory }}</code></p>
  </div>
</template>

<style scoped>
.catalog {
  display: grid;
  gap: var(--sp-4);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.search-field {
  flex: 1;
  min-width: 160px;
}
.kind-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.kind-filters button {
  min-height: var(--control-h-sm);
  padding: 0 var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--text-2);
  font-size: var(--fs-xs);
}
.kind-filters button:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.kind-filters button.active {
  border-color: var(--focus);
  background: color-mix(in srgb, var(--selection) 60%, var(--bg));
  color: var(--text);
}
.plugin-list {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.plugin-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
}
.plugin-row:hover {
  border-color: var(--line-strong);
}
.plugin-row.problem {
  border-color: color-mix(in srgb, var(--err) 40%, var(--line));
}
.plugin-open {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 1;
  min-width: 0;
  text-align: left;
  color: var(--text);
}
.row-icon {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text-2);
}
.row-icon svg {
  width: 16px;
  height: 16px;
}
.row-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.row-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  font-weight: 600;
}
.row-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.switch {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
  height: 22px;
  cursor: pointer;
}
.switch :deep(input) {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.switch > span {
  position: absolute;
  inset: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--bg-3);
}
.switch > span::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: var(--r-full);
  background: var(--muted);
  transition:
    transform var(--t-fast),
    background var(--t-fast);
}
.switch:has(input:checked) > span {
  border-color: var(--focus);
  background: var(--focus);
}
.switch:has(input:checked) > span::after {
  transform: translateX(16px);
  background: var(--bg);
}
.switch:has(input:focus-visible) > span {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.dropzone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg);
}
.drop-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text-2);
}
.drop-icon svg {
  width: 16px;
  height: 16px;
}
.dropzone strong {
  display: block;
  font-size: var(--fs-xs);
}
.dropzone p {
  margin: var(--sp-1) 0 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: var(--lh);
}
.dropzone > div {
  flex: 1;
  min-width: 180px;
}
.install-form {
  display: grid;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.install-form input {
  min-width: 220px;
}
.rebuild-hint {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: var(--lh);
}
.directory {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
</style>
