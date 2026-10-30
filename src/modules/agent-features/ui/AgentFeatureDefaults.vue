<script setup lang="ts">
import UiControl from "../../../common/ui/UiControl.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { useAgentFeatureDefaults } from "../model/defaults.ts";

/** Defaults of the feature matrix; the chat tab overrides them for its own conversation. */
const { data, busy, error, set, commands } = useAgentFeatureDefaults();

function toggle(feature: string, agent: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  void Promise.resolve(set(feature, agent, enabled)).catch(() => undefined);
}
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <section v-for="feature in data.features" :key="feature.id" class="feature">
      <h3>{{ feature.title }}</h3>
      <p class="summary">{{ feature.summary }}</p>
      <div class="agents">
        <label v-for="agent in feature.agents" :key="agent.id" class="agent">
          <UiControl
            type="checkbox"
            :id="`feature-default-${feature.id}-${agent.id}`"
            :name="feature.id"
            :checked="agent.enabled"
            :disabled="busy === `${feature.id}:${agent.id}`"
            :aria-label="`${feature.title}: ${agent.label}`"
            @change="toggle(feature.id, agent.id, $event)"
          />
          <span>{{ agent.label }}</span>
        </label>
      </div>
    </section>
    <p v-if="!data.features.length" class="hint">Возможностей пока нет.</p>
    <UiHint>
      Это умолчания для новых чатов. В табе агента остров «возможности» переопределяет их только для
      текущего чата; кнопка «Как по умолчанию» возвращает к этим значениям. Файл:
      <code>{{ data.file }}</code>
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>

<style scoped>
.feature {
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
h3 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
}
.summary {
  margin: 2px 0 var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.agents {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-4);
}
.agent {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--text);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.hint {
  margin: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
