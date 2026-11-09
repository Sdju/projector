<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiStack from "../../../../../common/ui/UiStack.vue";
import { computed } from "vue";
import { clientAgents } from "../../../../agents-integration/catalog/index.ts";
import { AgentFeatureDefaults } from "../../../../agent-features/index.ts";
import AgentIntegrationsSettings from "./AgentIntegrationsSettings.vue";
import AgentModeSettings from "./AgentModeSettings.vue";

/** One page per agent; the navigation opens it with the backend id. */
const props = defineProps<{ agentId?: string }>();
const emit = defineEmits<{ open: [id: string | undefined] }>();
const agent = computed(() => clientAgents().find((item) => item.backend === props.agentId));
</script>

<template>
  <UiStack as="section" :gap="4">
    <template v-if="!agent">
      <UiHint>
        У каждого адаптера своя страница: включение, режим сессий и возможности собраны в одном
        месте. Выберите агента слева или кнопкой ниже.
      </UiHint>
      <UiInline wrap :gap="2">
        <UiButton
          v-for="item in clientAgents()"
          :key="item.backend"
          :title="item.caption"
          @click="emit('open', item.backend)"
          >{{ item.title }}</UiButton
        >
      </UiInline>
    </template>

    <template v-else>
      <UiInline class="agent-heading" justify="normal" :gap="3">
        <component :is="agent.icon" class="agent-icon" aria-hidden="true" />
        <div>
          <h3>{{ agent.title }}</h3>
          <p>{{ agent.caption }}</p>
        </div>
      </UiInline>

      <UiHint v-if="agent.builtin">
        Встроенный агент Projector нельзя отключить, и у него нет терминального режима. Его
        возможности для новых чатов — ниже; остальные настройки Projector остаются отдельными
        разделами.
      </UiHint>

      <section v-else class="group">
        <h4>интеграция</h4>
        <AgentIntegrationsSettings :agent-id="agent.backend" />
      </section>

      <section v-if="!agent.builtin" class="group">
        <h4>сессии</h4>
        <AgentModeSettings :agent-id="agent.backend" />
      </section>

      <section class="group">
        <h4>возможности</h4>
        <AgentFeatureDefaults :agent="agent.backend" />
      </section>
    </template>
  </UiStack>
</template>

<style scoped>
.agent-heading {
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.agent-heading h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
}
.agent-heading p {
  margin: var(--sp-1) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.agent-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--muted);
}
.group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.group + .group {
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line);
}
.group h4 {
  margin: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 500;
  text-transform: lowercase;
}
</style>
