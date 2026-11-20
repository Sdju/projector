<script setup lang="ts">
import UiButton from "../../common/ui/UiButton.vue";
import UiLoader from "../../common/ui/UiLoader.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import PluginCatalog from "./PluginCatalog.vue";
import PluginPackage from "./PluginPackage.vue";
import { usePluginSettings } from "./model.ts";

const {
  catalog,
  selected,
  filtered,
  summary,
  runtimeDiagnostics,
  query,
  kind,
  mode,
  pageTab,
  installPath,
  busy,
  error,
  status,
  commands,
} = usePluginSettings();
</script>

<template>
  <section
    class="plugin-settings"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiLoader v-if="!catalog && busy" :padding="4">Загрузка локальных плагинов…</UiLoader>
    <UiMessage v-else-if="error && !catalog" tone="danger" variant="padded" role="alert">
      {{ error }}
      <UiButton size="sm" @click="commands.run('ide.plugins.refresh')">Повторить</UiButton>
    </UiMessage>
    <PluginPackage
      v-else-if="selected"
      :selected="selected"
      :page-tab="pageTab"
      :runtime-diagnostics="runtimeDiagnostics"
      :busy="busy"
      :error="error"
      :status="status"
      :commands="commands"
    />
    <PluginCatalog
      v-else-if="catalog"
      :catalog="catalog"
      :filtered="filtered"
      :summary="summary"
      :query="query"
      :kind="kind"
      :mode="mode"
      :install-path="installPath"
      :busy="busy"
      :error="error"
      :status="status"
      :commands="commands"
      @update:query="query = $event"
      @update:install-path="installPath = $event"
    />
  </section>
</template>

<style scoped>
.plugin-settings {
  display: grid;
  gap: var(--sp-4);
}
</style>
