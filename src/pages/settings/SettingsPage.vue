<script setup lang="ts">
import { ProviderPanel } from "../../modules/provider/index.ts";
import IntegrationSettings from "../../modules/integrations/IntegrationSettings.vue";
import InterfaceSettings from "../../modules/launcher/InterfaceSettings.vue";
</script>

<template>
  <section>
    <router-link class="back" to="/">← поиск</router-link>
    <InterfaceSettings />
    <IntegrationSettings />
    <h1>модель</h1>
    <p class="lead">Агент добавления проектов ходит в Qwen через OpenAI-compatible API, как в ai-companion.</p>
    <ProviderPanel />
  </section>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: 18px;
  color: var(--muted);
  font-size: 13px;
}

h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.lead {
  margin: 0 0 24px;
  color: var(--muted);
}
</style>
