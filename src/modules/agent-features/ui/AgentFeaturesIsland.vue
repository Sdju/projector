<script setup lang="ts">
import UiControl from "../../../common/ui/UiControl.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { useAgentFeatures } from "../model/features.ts";
import IconSparkles from "~icons/lucide/sparkles";

/**
 * The abilities island: optional features the user hands to individual agents. It is the only
 * place that enables them; the server injects the enabled text into the agent's prompt.
 */
const { data, busy, error, load, set, commands } = useAgentFeatures();

const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ["input:not(:disabled)", "button:not(:disabled)"],
  items: "input, button",
  returnFocus: ".trigger",
});

commands.scope.registerCommand({
  id: "ide.agent.features.panel",
  title: "Открыть возможности агентов",
  description:
    "Открывает или закрывает остров возможностей в шапке: какие необязательные возможности (виджеты в ответах) включены у Projector, Claude Code, Codex, OpenCode, Cursor и Kimi.",
  run: () => open(),
});

function open() {
  if (!menu.open.value) void load().catch(() => undefined);
  commands.scope.activate();
  menu.toggle();
}

function toggle(feature: string, agent: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  void Promise.resolve(set(feature, agent, enabled)).catch(() => undefined);
}
</script>

<template>
  <div :ref="(element) => (menu.trigger.value = element as HTMLElement)" class="features">
    <button
      type="button"
      class="trigger"
      :aria-expanded="menu.open.value"
      :aria-controls="menu.id"
      aria-label="Возможности агентов"
      title="Возможности агентов"
      @click="open"
    >
      <IconSparkles aria-hidden="true" />
      <span>возможности</span>
    </button>
  </div>
  <UiIsland :menu="menu" label="Возможности агентов" :width="340">
    <UiIslandLabel>Возможности агентов</UiIslandLabel>
    <p class="note">
      Агент получает их в промпте. Codex, OpenCode, Cursor и Kimi — в новой сессии.
    </p>
    <section v-for="feature in data.features" :key="feature.id" class="feature">
      <p class="feature-title">{{ feature.title }}</p>
      <p class="feature-summary">{{ feature.summary }}</p>
      <label v-for="agent in feature.agents" :key="agent.id" class="agent">
        <UiControl
          type="checkbox"
          :id="`feature-${feature.id}-${agent.id}`"
          :name="feature.id"
          :checked="agent.enabled"
          :disabled="busy === agent.id"
          :aria-label="`${feature.title}: ${agent.label}`"
          @change="toggle(feature.id, agent.id, $event)"
        />
        <span class="agent-name">{{ agent.label }}</span>
      </label>
    </section>
    <p v-if="!data.features.length" class="note">Возможностей пока нет.</p>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <p v-if="data.file" class="file" :title="data.file">features.json в данных Projector</p>
  </UiIsland>
</template>

<style scoped>
.trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 2px var(--sp-2);
  border: 0;
  border-radius: var(--r-full);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.trigger:hover,
.trigger[aria-expanded="true"] {
  background: var(--hover);
  color: var(--text);
}
.trigger svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.note {
  margin: 0;
  padding: 0 var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.feature {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2);
  border-top: 1px solid var(--line);
}
.feature-title {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.feature-summary {
  margin: 0 0 var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.agent {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 2px 0;
  color: var(--text);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.agent input:disabled + .agent-name {
  color: var(--faint);
}
.file {
  margin: 0;
  padding: 0 var(--sp-2) var(--sp-1);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
