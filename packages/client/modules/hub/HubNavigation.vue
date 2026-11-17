<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { deviceBase } from "../../common/utilities/device-url.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import UiInline from "../../common/ui/UiInline.vue";
import { fetchHubPresence, logoutHub } from "./client.ts";
const device = computed(() => deviceBase().split("/")[2]);
const local = ref<boolean>();
onMounted(async () => {
  if (device.value) local.value = (await fetchHubPresence().catch(() => undefined))?.local ?? false;
});
const commands = useCommandScope("hub-navigation", () => ({
  surface: "hub-navigation",
  device: device.value ?? "",
}));
commands.scope.registerCommand({
  id: "ide.hub.devices.open",
  title: "Устройства Hub",
  description:
    "Возвращает к списку устройств Hub. Текущие задания и терминалы продолжают работать на машине.",
  run: () => location.assign("/"),
});
commands.scope.registerCommand({
  id: "ide.hub.logout",
  title: "Выйти из Hub",
  description: "Отзывает текущую сессию Hub и закрывает её удалённые соединения.",
  enabled: () => local.value === false,
  run: logoutHub,
});
</script>
<template>
  <UiInline
    v-if="device"
    class="hub-nav"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiButton
      size="sm"
      appearance="quiet"
      :title="local ? 'Вернуться на локальное устройство' : `Устройства Hub · ${device}`"
      @click="commands.run('ide.hub.devices.open')"
      >Hub · {{ device }}</UiButton
    >
    <UiButton
      v-if="local === false"
      size="sm"
      appearance="quiet"
      @click="commands.run('ide.hub.logout')"
      >Выйти</UiButton
    >
  </UiInline>
</template>
<style scoped>
.hub-nav {
  flex-shrink: 0;
}
</style>
