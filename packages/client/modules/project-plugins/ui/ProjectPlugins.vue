<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { watch } from "vue";
import { runtimeIssues } from "../../plugin-runtime/index.ts";
import type { Project } from "../../project/index.ts";
import { useProjectPluginSettings } from "../model/settings.ts";

const props = defineProps<{ project: Project }>();
const { plugins, loaded, busy, error, trusted, enabled, load, trust, setEnabled, refresh } =
  useProjectPluginSettings(() => props.project.id);

watch(
  () => props.project.id,
  () => void load().catch(() => undefined),
  { immediate: true },
);

function contributions(plugin: (typeof plugins.value)[number]): string {
  const parts = [
    plugin.agents.length ? `агентов: ${plugin.agents.length}` : "",
    plugin.panels.length ? `панелей: ${plugin.panels.length}` : "",
    plugin.tabs.length ? `вкладок: ${plugin.tabs.length}` : "",
    plugin.languages.length ? `языков: ${plugin.languages.length}` : "",
    plugin.http.length ? `маршрутов: ${plugin.http.length}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "только код";
}

function issues(plugin: (typeof plugins.value)[number]) {
  return runtimeIssues.value.filter((issue) => issue.plugin === plugin.id);
}

async function setTrust(plugin: (typeof plugins.value)[number], value: boolean) {
  await trust(plugin.packageName || plugin.id, value).catch(() => undefined);
}

async function toggle(plugin: (typeof plugins.value)[number], value: boolean) {
  await setEnabled(plugin.packageName || plugin.id, value).catch(() => undefined);
}
</script>

<template>
  <UiStack as="section" :gap="4" class="project-plugins">
    <div class="head">
      <UiInline wrap :gap="2">
        <code>.projector/plugins</code>
        <span v-if="loaded" class="count"
          >{{ plugins.length }} · включено {{ enabled }} · доверено {{ trusted }}</span
        >
      </UiInline>
      <UiInline :gap="2">
        <UiButton size="sm" :busy="busy === 'refresh'" @click="refresh().catch(() => undefined)"
          >Обновить</UiButton
        >
      </UiInline>
    </div>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <UiMessage v-else-if="loaded && !plugins.length" tone="muted" variant="note" size="xs" flush>
      В проекте нет плагинов. Положите пакет в <code>.projector/plugins/&lt;имя&gt;/</code> — он
      появится здесь и будет ждать доверия. Код из репозитория не запускается автоматически.
    </UiMessage>
    <UiCard
      v-for="plugin in plugins"
      :key="plugin.id"
      as="article"
      appearance="frame"
      class="plugin"
    >
      <div class="title">
        <code class="name">{{ plugin.packageName || plugin.id }}</code>
        <span v-if="plugin.version" class="tag">{{ plugin.version }}</span>
        <span v-if="plugin.status === 'enabled'" class="state on">включён</span>
        <span v-else-if="plugin.status === 'error'" class="state bad">ошибка</span>
        <span v-else class="state">выключен</span>
        <span v-if="plugin.requiresTrust" class="tag" :class="{ trusted: plugin.trusted }">{{
          plugin.trusted ? "доверено" : "нужно доверие"
        }}</span>
      </div>
      <p class="meta">{{ contributions(plugin) }}</p>
      <UiMessage
        v-for="diagnostic in plugin.diagnostics"
        :key="diagnostic.message"
        tone="danger"
        size="xs"
        flush
        role="alert"
        >{{ diagnostic.message }}</UiMessage
      >
      <UiMessage
        v-for="issue in issues(plugin)"
        :key="issue.phase + issue.message"
        tone="danger"
        size="xs"
        flush
        role="alert"
        >{{ issue.message }}</UiMessage
      >
      <UiInline wrap :gap="2" class="actions">
        <UiButton
          v-if="plugin.requiresTrust && !plugin.trusted"
          appearance="solid"
          size="sm"
          :busy="busy === (plugin.packageName || plugin.id)"
          @click="setTrust(plugin, true)"
          >Доверять и включить</UiButton
        >
        <UiButton
          v-else-if="!plugin.enabled"
          appearance="solid"
          size="sm"
          :busy="busy === (plugin.packageName || plugin.id)"
          :disabled="plugin.status === 'error'"
          @click="toggle(plugin, true)"
          >Включить</UiButton
        >
        <UiButton
          v-else
          size="sm"
          :busy="busy === (plugin.packageName || plugin.id)"
          @click="toggle(plugin, false)"
          >Выключить</UiButton
        >
        <UiButton
          v-if="plugin.requiresTrust && plugin.trusted"
          appearance="outline"
          size="sm"
          :busy="busy === (plugin.packageName || plugin.id)"
          @click="setTrust(plugin, false)"
          >Отозвать доверие</UiButton
        >
      </UiInline>
      <p v-if="plugin.source" class="source">{{ plugin.source }}</p>
    </UiCard>
    <UiHint>
      Проектные плагины работают только в этом проекте. Доверие привязано к хешу содержимого: правка
      файлов или <code>git pull</code> отзывает его и создаёт уведомление. Код выполняется с правами
      сервера или страницы Projector — доверяйте только тому, что готовы запустить.
    </UiHint>
  </UiStack>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.head code {
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.count {
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.name {
  color: var(--text);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.tag {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.tag.trusted {
  border-color: var(--run);
  color: var(--run);
}
.state {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state.on {
  color: var(--run);
}
.state.bad {
  color: var(--err);
}
.meta {
  margin: var(--sp-2) 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.actions {
  margin-top: var(--sp-2);
}
.source {
  margin: var(--sp-2) 0 0;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
  overflow-wrap: anywhere;
}
</style>
