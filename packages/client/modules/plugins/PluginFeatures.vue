<script setup lang="ts">
import { computed } from "vue";
import UiBadge from "../../common/ui/UiBadge.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiEmpty from "../../common/ui/UiEmpty.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import { currentAppearance } from "../appearance/index.ts";
import type { PluginInfo } from "./client.ts";
import {
  pluginHasContributions,
  pluginHttpAccessLabel,
  pluginHttpMethodsLabel,
  pluginHttpUrl,
  shortPluginHash,
} from "./kinds.ts";
import PluginThemePreview from "./PluginThemePreview.vue";

const props = defineProps<{
  selected: PluginInfo;
  busy: boolean;
  status: string;
  commands: { run: (id: string, args?: unknown) => void };
}>();
const activeAppearance = computed(() => {
  void props.status;
  return currentAppearance();
});
const dependencyEntries = computed(() => Object.entries(props.selected.dependencies ?? {}));
</script>

<template>
  <div class="features">
    <UiEmpty v-if="!pluginHasContributions(selected)" density="compact" align="start">
      Нет доступных вкладов. Проверьте диагностику пакета.
    </UiEmpty>
    <template v-else>
      <section v-if="selected.agents.length">
        <h3>Агенты</h3>
        <div v-for="agent in selected.agents" :key="agent.id" class="agent-row">
          <UiInline align="center" wrap>
            <strong>{{ agent.title }}</strong>
            <UiBadge tone="neutral">{{ agent.id }}</UiBadge>
          </UiInline>
          <code v-if="agent.command">{{ [agent.command, ...(agent.args ?? [])].join(" ") }}</code>
          <UiHint>{{
            agent.caption || `Терминальная программа: ${agent.program || agent.id}`
          }}</UiHint>
        </div>
      </section>
      <section v-if="selected.balances.length">
        <h3>Балансы провайдеров</h3>
        <div v-for="balance in selected.balances" :key="balance.kind" class="agent-row">
          <UiInline align="center" wrap>
            <strong>{{ balance.title }}</strong>
            <UiBadge tone="neutral">{{ balance.kind }}</UiBadge>
          </UiInline>
          <UiHint>{{
            balance.description || "Плагин читает остаток этого вида провайдера."
          }}</UiHint>
        </div>
      </section>
      <section v-if="selected.http.length">
        <h3>HTTP-маршруты</h3>
        <div v-for="route in selected.http" :key="route.id" class="http-row">
          <UiInline align="center" wrap>
            <UiBadge mono>{{ pluginHttpMethodsLabel(route) }}</UiBadge>
            <strong>{{ route.id }}</strong>
          </UiInline>
          <code>{{ pluginHttpUrl(selected.id, route) }}</code>
          <UiHint>{{ pluginHttpAccessLabel(route) }}</UiHint>
        </div>
      </section>
      <section v-if="selected.languages.length || selected.panels.length || selected.tabs.length">
        <h3>Интерфейс</h3>
        <UiHint v-if="selected.languages.length"
          >Языки: {{ selected.languages.map((item) => item.title).join(", ") }}</UiHint
        >
        <UiHint v-if="selected.panels.length"
          >Панели: {{ selected.panels.map((item) => item.title).join(", ") }}</UiHint
        >
        <UiHint v-if="selected.tabs.length"
          >Вкладки: {{ selected.tabs.map((item) => item.title).join(", ") }}</UiHint
        >
      </section>
      <section v-if="selected.themes.length">
        <h3>Темы</h3>
        <div class="theme-grid">
          <article v-for="theme in selected.themes" :key="theme.id" class="theme-card">
            <PluginThemePreview :theme="theme" size="mini" />
            <div>
              <strong>{{ theme.title }}</strong>
              <UiHint>{{ theme.mode === "dark" ? "Тёмная" : "Светлая" }}</UiHint>
            </div>
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
      </section>
    </template>
    <p v-if="selected.hash" class="hash">
      Хеш: <code :title="selected.hash">{{ shortPluginHash(selected.hash) }}</code>
    </p>
    <div v-if="dependencyEntries.length" class="deps">
      <span>Зависимости</span>
      <UiInline wrap>
        <UiBadge v-for="[name, version] in dependencyEntries" :key="name" tone="neutral"
          >{{ name }}@{{ version }}</UiBadge
        >
      </UiInline>
    </div>
  </div>
</template>

<style scoped>
.features {
  display: grid;
  gap: var(--sp-3);
}
.features h3 {
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.agent-row,
.http-row {
  display: grid;
  gap: 2px;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg);
}
.agent-row + .agent-row,
.http-row + .http-row {
  margin-top: var(--sp-2);
}
.agent-row code,
.http-row code {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.theme-grid {
  display: grid;
  gap: var(--sp-2);
}
.theme-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--sp-3);
}
.hash,
.deps {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.hash {
  margin: 0;
}
.deps {
  display: grid;
  gap: var(--sp-1);
}
</style>
