<script setup lang="ts">
import LauncherWindowSettings from "./LauncherWindowSettings.vue";
import AppearanceSettingsSection from "./AppearanceSettingsSection.vue";
import InterfaceFontSettings from "./InterfaceFontSettings.vue";
</script>

<template>
  <section class="interface-settings">
    <LauncherWindowSettings />
    <AppearanceSettingsSection />
    <InterfaceFontSettings />
  </section>
</template>

<style scoped>
.interface-settings {
  display: grid;
  gap: var(--sp-4);
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
</style>
