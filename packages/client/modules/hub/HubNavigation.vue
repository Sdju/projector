<script setup lang="ts">
import { computed } from "vue";
import { deviceBase } from "../../common/utilities/device-url.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import UiInline from "../../common/ui/UiInline.vue";
import { logoutHub } from "./client.ts";
const device = computed(() => deviceBase().split("/")[2]);
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
      :title="`Устройства Hub · ${device}`"
      @click="commands.run('ide.hub.devices.open')"
      >Hub · {{ device }}</UiButton
    >
    <UiButton size="sm" appearance="quiet" @click="commands.run('ide.hub.logout')">Выйти</UiButton>
  </UiInline>
</template>
<style scoped>
.hub-nav {
  flex-shrink: 0;
}
</style>
