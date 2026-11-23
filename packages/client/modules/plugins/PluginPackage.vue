<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiBadge from "../../common/ui/UiBadge.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import type { PluginInfo } from "./client.ts";
import {
  pluginKindHint,
  pluginNeedsTrust,
  pluginPageTabs,
  pluginStatusLabels,
  pluginStatusTone,
  type PluginPageTab,
} from "./kinds.ts";
import PluginFeatures from "./PluginFeatures.vue";
import PluginReadme from "./PluginReadme.vue";

defineProps<{
  selected: PluginInfo;
  pageTab: PluginPageTab;
  runtimeDiagnostics: { phase: string; message: string }[];
  busy: boolean;
  error: string;
  status: string;
  commands: { run: (id: string, args?: unknown) => void };
}>();
</script>

<template>
  <div class="plugin-details">
    <p class="crumb">
      <button type="button" @click="commands.run('ide.plugin.close')">
        <ProjectorIcon name="chevron-left" aria-hidden="true" />Плагины
      </button>
      <span aria-hidden="true">/</span>
      <span>{{ selected.id }}</span>
    </p>

    <header class="package-head">
      <div class="identity">
        <h2 :title="selected.path">{{ selected.id }}</h2>
        <p>{{ selected.description || pluginKindHint(selected) }}</p>
        <p v-if="selected.source" class="source" :title="selected.source">
          Исходники: <code>{{ selected.source }}</code>
        </p>
        <UiInline wrap :gap="1">
          <UiBadge v-if="selected.version" mono>v{{ selected.version }}</UiBadge>
          <UiBadge v-if="selected.code" tone="warning">код</UiBadge>
          <UiBadge v-if="selected.trusted && selected.requiresTrust" tone="info">доверен</UiBadge>
          <UiBadge :tone="pluginStatusTone(selected.status)">{{
            pluginStatusLabels[selected.status]
          }}</UiBadge>
        </UiInline>
      </div>
      <div class="actions">
        <UiButton
          v-if="
            selected.enabled && (selected.status === 'enabled' || selected.status === 'disabled')
          "
          size="sm"
          :disabled="busy"
          @click="commands.run('ide.plugin.disable', { id: selected.id })"
          >Выключить</UiButton
        >
        <UiButton
          v-else-if="pluginNeedsTrust(selected)"
          size="sm"
          appearance="solid"
          :disabled="busy"
          @click="commands.run('ide.plugin.trust', { id: selected.id })"
          >Доверие</UiButton
        >
        <UiButton
          v-else-if="selected.status === 'enabled' || selected.status === 'disabled'"
          size="sm"
          appearance="solid"
          :disabled="busy"
          @click="commands.run('ide.plugin.enable', { id: selected.id })"
          >Включить</UiButton
        >
        <UiButton
          v-if="selected.source"
          size="sm"
          :disabled="busy"
          title="Собрать projector.build в исходниках и включить с доверием"
          @click="commands.run('ide.plugin.rebuild', { id: selected.id })"
          >Пересобрать</UiButton
        >
        <UiButton
          size="sm"
          appearance="quiet"
          :disabled="busy"
          @click="commands.run('ide.plugin.remove', { id: selected.id })"
          >Удалить</UiButton
        >
      </div>
    </header>

    <UiMessage v-if="pluginNeedsTrust(selected)" tone="warning" size="xs" wrap>
      Доверенный код не изолирован песочницей. Подтвердите текущее содержимое пакета.
    </UiMessage>
    <div v-if="selected.diagnostics.length || runtimeDiagnostics.length" class="diagnostics">
      <UiMessage
        v-for="(item, index) in selected.diagnostics"
        :key="index"
        tone="danger"
        size="xs"
        wrap
      >
        {{ item.message }}
      </UiMessage>
      <UiMessage
        v-for="(item, index) in runtimeDiagnostics"
        :key="`runtime-${index}`"
        tone="danger"
        size="xs"
        wrap
      >
        {{ item.phase }}: {{ item.message }}
      </UiMessage>
    </div>

    <div class="tabs" role="tablist" aria-label="Страница плагина">
      <button
        v-for="item in pluginPageTabs"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="pageTab === item.id"
        :class="{ active: pageTab === item.id }"
        @click="commands.run('ide.plugin.page.tab', { tab: item.id })"
      >
        {{ item.title }}
      </button>
    </div>
    <PluginReadme v-if="pageTab === 'readme'" :plugin="selected" />
    <PluginFeatures
      v-else
      :selected="selected"
      :busy="busy"
      :status="status"
      :commands="commands"
    />
    <UiMessage v-if="error || status" role="status" :tone="error ? 'danger' : undefined">
      {{ error || status }}
    </UiMessage>
  </div>
</template>

<style scoped>
.plugin-details {
  display: grid;
  gap: var(--sp-3);
}
.crumb {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.crumb button {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--text-2);
}
.crumb button svg {
  width: 14px;
  height: 14px;
}
.package-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}
.identity {
  min-width: 0;
}
.identity h2 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  font-weight: 600;
}
.identity p {
  margin: 2px 0 var(--sp-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.identity .source {
  margin-top: calc(var(--sp-1) * -1);
  font-size: var(--fs-2xs);
}
.identity .source code {
  font-size: inherit;
}
.actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.diagnostics {
  display: grid;
  gap: var(--sp-2);
}
.tabs {
  display: flex;
  gap: var(--sp-1);
  border-bottom: 1px solid var(--line);
}
.tabs button {
  margin-bottom: -1px;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.tabs button.active {
  border-bottom-color: var(--focus);
  color: var(--text);
}
</style>
