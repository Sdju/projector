<script setup lang="ts">
import { computed, useId } from "vue";
import type { AvailableTheme } from "@ai-projector/core/modules/plugins/index.ts";
import UiBadge from "../../common/ui/UiBadge.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiCard from "../../common/ui/UiCard.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiEmpty from "../../common/ui/UiEmpty.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiLoader from "../../common/ui/UiLoader.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { currentAppearance } from "../appearance/index.ts";
import { usePluginSettings } from "./model.ts";
import type { PluginStatus } from "./client.ts";

const searchId = useId();
const pathId = useId();
const { catalog, selected, filtered, query, mode, installPath, busy, error, status, commands } =
  usePluginSettings();
const activeAppearance = computed(() => {
  void status.value;
  return currentAppearance();
});
const statusLabels: Record<PluginStatus, string> = {
  enabled: "Включён",
  disabled: "Выключен",
  error: "Ошибка",
  missing: "Отсутствует",
};
function statusTone(value: PluginStatus) {
  return value === "error" || value === "missing"
    ? "danger"
    : value === "enabled"
      ? "info"
      : "neutral";
}
function previewStyle(theme: AvailableTheme) {
  return {
    "--preview-bg": theme.tokens.bg,
    "--preview-panel": theme.tokens["bg-2"],
    "--preview-text": theme.tokens.text,
    "--preview-muted": theme.tokens.muted,
    "--preview-accent": theme.tokens.accent,
    "--preview-line": theme.tokens.line,
  };
}
</script>

<template>
  <section
    class="plugin-settings"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiInline class="toolbar" align="center" justify="between" wrap>
      <div>
        <UiHeading as="h2" size="sm">Локальные плагины</UiHeading>
        <UiHint>Декларативные темы и ACP-агенты без исполняемого кода плагина.</UiHint>
      </div>
      <UiInline wrap>
        <UiButton :disabled="busy" @click="commands.run('ide.plugins.refresh')">Обновить</UiButton>
        <UiButton
          appearance="solid"
          :disabled="busy"
          @click="commands.run('ide.plugins.folder.open')"
        >
          Установить из папки
        </UiButton>
      </UiInline>
    </UiInline>

    <div class="filters">
      <div class="search-field">
        <UiLabel :for="searchId" size="sm">Поиск</UiLabel>
        <UiControl
          :id="searchId"
          v-model="query"
          type="search"
          placeholder="Имя или описание"
          :disabled="busy && !catalog"
        />
      </div>
      <div>
        <UiLabel for="plugin-mode" size="sm">Режим темы</UiLabel>
        <UiControl id="plugin-mode" v-model="mode" as="select" :disabled="busy && !catalog">
          <option value="all">Все темы</option>
          <option value="dark">Тёмные</option>
          <option value="light">Светлые</option>
        </UiControl>
      </div>
    </div>

    <UiLoader v-if="!catalog && busy" :padding="4">Загрузка локальных плагинов…</UiLoader>
    <UiMessage v-else-if="error && !catalog" tone="danger" variant="padded" role="alert">
      {{ error }}
      <UiButton size="sm" @click="commands.run('ide.plugins.refresh')">Повторить</UiButton>
    </UiMessage>
    <UiEmpty v-else-if="catalog && !catalog.plugins.length">
      Плагины не установлены. Выберите локальную папку с манифестом Projector.
    </UiEmpty>
    <UiEmpty v-else-if="catalog && !filtered.length">
      По текущему поиску и фильтру плагины не найдены.
    </UiEmpty>

    <ul v-if="filtered.length" class="plugin-list" aria-label="Установленные плагины">
      <li v-for="plugin in filtered" :key="plugin.id">
        <UiCard as="article" :class="{ selected: selected?.id === plugin.id }">
          <div class="plugin-heading">
            <button
              type="button"
              class="plugin-open"
              :aria-pressed="selected?.id === plugin.id"
              @click="commands.run('ide.plugin.open', { id: plugin.id })"
            >
              <strong>{{ plugin.id }}</strong>
              <span v-if="plugin.version">v{{ plugin.version }}</span>
            </button>
            <UiInline align="center" :gap="1">
              <UiBadge v-if="plugin.code" tone="warning">код</UiBadge>
              <UiBadge :tone="statusTone(plugin.status)">{{ statusLabels[plugin.status] }}</UiBadge>
            </UiInline>
          </div>
          <p v-if="plugin.description" class="description">{{ plugin.description }}</p>
          <div v-if="plugin.themes.length" class="card-previews" aria-hidden="true">
            <span
              v-for="theme in plugin.themes.slice(0, 2)"
              :key="theme.id"
              class="mini-preview"
              :style="previewStyle(theme)"
              ><i /><i /><i
            /></span>
          </div>
          <UiInline v-if="plugin.status === 'enabled' || plugin.status === 'disabled'" wrap>
            <UiButton
              v-if="plugin.enabled"
              size="sm"
              :disabled="busy"
              @click="commands.run('ide.plugin.disable', { id: plugin.id })"
              >Выключить</UiButton
            >
            <UiButton
              v-else-if="plugin.agents.length && !plugin.trusted"
              size="sm"
              appearance="solid"
              :disabled="busy"
              @click="commands.run('ide.plugin.trust', { id: plugin.id })"
              >Подтвердить доверие</UiButton
            >
            <UiButton
              v-else
              size="sm"
              appearance="solid"
              :disabled="busy"
              @click="commands.run('ide.plugin.enable', { id: plugin.id })"
              >Включить</UiButton
            >
          </UiInline>
        </UiCard>
      </li>
    </ul>

    <UiCard v-if="selected" class="plugin-details" appearance="frame">
      <UiInline align="center" justify="between" wrap>
        <div>
          <UiHeading as="h3" size="sm">{{ selected.id }}</UiHeading>
          <UiHint>
            {{
              selected.code
                ? "ACP-агент с доверенным серверным кодом"
                : selected.agents.length
                  ? "ACP-агент и темы · только данные, без кода"
                  : "Темы интерфейса · только данные, без кода"
            }}
          </UiHint>
        </div>
        <UiBadge :tone="statusTone(selected.status)">{{ statusLabels[selected.status] }}</UiBadge>
      </UiInline>
      <p v-if="selected.description" class="detail-description">{{ selected.description }}</p>
      <code v-if="selected.path" class="plugin-path">{{ selected.path }}</code>
      <div v-if="selected.agents.length" class="agent-contributions">
        <strong>Агенты</strong>
        <div v-for="agent in selected.agents" :key="agent.id" class="agent-row">
          <UiInline align="center" wrap>
            <strong>{{ agent.title }}</strong>
            <UiBadge tone="neutral">{{ agent.id }}</UiBadge>
          </UiInline>
          <code>{{ [agent.command, ...(agent.args ?? [])].join(" ") }}</code>
          <UiHint>{{
            agent.caption || `Терминальная программа: ${agent.program || agent.id}`
          }}</UiHint>
        </div>
        <UiMessage v-if="!selected.trusted" tone="danger" size="xs" wrap>
          Команда будет запущена на этой машине. Подтвердите доверие к текущему содержимому пакета;
          после его изменения доверие потребуется снова.
        </UiMessage>
        <UiInline wrap>
          <UiButton
            v-if="!selected.trusted"
            size="sm"
            appearance="solid"
            :disabled="busy"
            @click="commands.run('ide.plugin.trust', { id: selected.id })"
            >Подтвердить доверие</UiButton
          >
          <UiButton
            size="sm"
            :disabled="busy"
            @click="commands.run('ide.plugin.remove', { id: selected.id })"
            >Удалить плагин</UiButton
          >
        </UiInline>
      </div>
      <div v-if="selected.diagnostics.length" class="diagnostics">
        <strong>Диагностика</strong>
        <UiMessage
          v-for="(item, index) in selected.diagnostics"
          :key="index"
          tone="danger"
          size="xs"
          wrap
        >
          {{ item.message }}
        </UiMessage>
      </div>
      <UiEmpty
        v-if="!selected.themes.length && !selected.agents.length"
        density="compact"
        align="start"
      >
        Нет доступных тем или агентов. Проверьте диагностику пакета.
      </UiEmpty>
      <div v-else-if="selected.themes.length" class="theme-grid">
        <article v-for="theme in selected.themes" :key="theme.id" class="theme-card">
          <div class="theme-preview" :style="previewStyle(theme)" aria-hidden="true">
            <div class="preview-sidebar"><i /><i /><i /></div>
            <div class="preview-content"><i /><i /><i /></div>
          </div>
          <div>
            <strong>{{ theme.title }}</strong>
            <UiHint>{{ theme.mode === "dark" ? "Тёмная" : "Светлая" }}</UiHint>
          </div>
          <p v-if="theme.description">{{ theme.description }}</p>
          <UiButton
            size="sm"
            :appearance="activeAppearance === theme.id ? 'outline' : 'solid'"
            :disabled="busy || !selected.enabled || selected.status !== 'enabled'"
            @click="commands.run('ide.plugin.theme.apply', { id: theme.id })"
          >
            {{ activeAppearance === theme.id ? "Применена" : "Применить" }}
          </UiButton>
        </article>
      </div>
      <UiInline v-if="!selected.agents.length" wrap>
        <UiButton
          size="sm"
          :disabled="busy"
          @click="commands.run('ide.plugin.remove', { id: selected.id })"
          >Удалить плагин</UiButton
        >
      </UiInline>
    </UiCard>

    <form class="install-form" @submit.prevent="commands.run('ide.plugins.install')">
      <UiLabel :for="pathId" size="sm">Или укажите путь к локальной папке</UiLabel>
      <UiInline align="stretch" wrap>
        <UiControl
          :id="pathId"
          v-model="installPath"
          grow
          mono
          placeholder="/path/to/theme-plugin"
          :disabled="busy"
        />
        <UiButton type="submit" :disabled="busy || !installPath.trim()">Установить</UiButton>
      </UiInline>
    </form>
    <UiMessage
      v-if="catalog && (error || status)"
      role="status"
      :tone="error ? 'danger' : undefined"
    >
      {{ error || status }}
    </UiMessage>
    <UiHint v-if="catalog" class="directory"
      >Локальный каталог: <code>{{ catalog.directory }}</code></UiHint
    >
  </section>
</template>

<style scoped>
.plugin-settings {
  display: grid;
  gap: var(--sp-4);
}
.toolbar > div:first-child {
  min-width: 220px;
}
.filters {
  display: flex;
  align-items: end;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.filters > div {
  display: grid;
  gap: var(--sp-1);
}
.search-field {
  flex: 1;
  min-width: 200px;
}
.filters select {
  min-width: 140px;
}
.plugin-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.plugin-list article.selected {
  border-color: var(--focus);
}
.plugin-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--sp-2);
}
.plugin-open {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: left;
  color: var(--text);
}
.plugin-open strong {
  overflow-wrap: anywhere;
}
.plugin-open span {
  color: var(--faint);
}
.description,
.detail-description,
.theme-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.45;
}
.card-previews {
  display: flex;
  gap: var(--sp-2);
}
.mini-preview {
  display: flex;
  align-items: end;
  gap: 3px;
  width: 56px;
  height: 32px;
  padding: 5px;
  border: 1px solid var(--preview-line);
  border-radius: var(--r-sm);
  background: var(--preview-bg);
}
.mini-preview i {
  display: block;
  width: 12px;
  height: 5px;
  border-radius: 2px;
  background: var(--preview-accent);
}
.mini-preview i:nth-child(2) {
  width: 18px;
  background: var(--preview-text);
}
.mini-preview i:nth-child(3) {
  background: var(--preview-muted);
}
.plugin-details {
  display: grid;
  gap: var(--sp-4);
}
.plugin-path {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.diagnostics {
  display: grid;
  gap: var(--sp-2);
}
.agent-contributions {
  display: grid;
  gap: var(--sp-2);
}
.agent-row {
  display: grid;
  gap: 2px;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.agent-row code {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--sp-3);
}
.theme-card {
  display: grid;
  align-content: start;
  gap: var(--sp-2);
  color: var(--text);
}
.theme-card .btn {
  justify-self: start;
}
.theme-preview {
  display: grid;
  grid-template-columns: 34% 1fr;
  height: 104px;
  overflow: hidden;
  border: 1px solid var(--preview-line);
  border-radius: var(--r-md);
  background: var(--preview-bg);
}
.preview-sidebar {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 12px 9px;
  background: var(--preview-panel);
}
.preview-sidebar i,
.preview-content i {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--preview-muted);
}
.preview-sidebar i:first-child {
  background: var(--preview-accent);
}
.preview-content {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 16px 12px;
}
.preview-content i:first-child {
  width: 70%;
  height: 8px;
  background: var(--preview-text);
}
.preview-content i:last-child {
  width: 55%;
  background: var(--preview-accent);
}
.install-form {
  display: grid;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line);
}
.install-form input {
  min-width: 220px;
}
.directory {
  overflow-wrap: anywhere;
}
</style>
