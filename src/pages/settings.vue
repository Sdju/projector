<script setup lang="ts">
import UiHint from "../common/ui/UiHint.vue";
import { ProviderPanel } from "../modules/provider/index.ts";
import { IntegrationSettings } from "../modules/integrations/index.ts";
import { InterfaceSettings } from "../modules/launcher/index.ts";
import { NetworkSettings } from "../modules/network/index.ts";
import { EditorSettings } from "../modules/workspace/index.ts";
</script>

<template>
  <section>
    <router-link class="back" to="/">← поиск</router-link>
    <h1>Настройки</h1>
    <InterfaceSettings />
    <NetworkSettings />
    <EditorSettings />
    <IntegrationSettings />
    <section class="model">
      <h2>Модель</h2>
      <UiHint class="lead">
        Агент добавления проектов ходит в Qwen через OpenAI-compatible API, как в ai-companion.
      </UiHint>
      <ProviderPanel />
    </section>
  </section>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
}

.back:hover {
  color: var(--text);
}

h1 {
  margin: 0 0 var(--sp-5);
  font-size: var(--fs-xl);
  font-weight: 500;
}

h2 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-lg);
  font-weight: 500;
}

.lead {
  margin-bottom: var(--sp-4);
  font-size: var(--fs-sm);
}
</style>
