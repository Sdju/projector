<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiField from "../../common/ui/UiField.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { hubRequest } from "./client.ts";

const token = ref("");
const busy = ref(false);
const error = ref("");
const abort = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
const commands = useCommandScope("hub-token", () => ({ surface: "hub" }));
function hide() {
  clearTimeout(timer);
  token.value = "";
}
commands.scope.registerCommand({
  id: "ide.hub.token.show",
  title: "Показать токен подключения Hub",
  description:
    "Запрашивает токен для подключения устройств после проверки сессии Hub и показывает его на 30 секунд.",
  enabled: () => !busy.value && !token.value,
  run: async () => {
    busy.value = true;
    error.value = "";
    try {
      const data = await hubRequest<{ token: string }>("/api/hub/device-token", {
        method: "POST",
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      token.value = data.token;
      timer = setTimeout(hide, 30_000);
    } catch {
      if (!abort.signal.aborted)
        error.value = "Не удалось показать токен. Проверьте вход в Hub и повторите попытку.";
    } finally {
      busy.value = false;
    }
  },
});
commands.scope.registerCommand({
  id: "ide.hub.token.hide",
  title: "Скрыть токен подключения Hub",
  description: "Очищает показанный токен подключения устройств.",
  enabled: () => !!token.value,
  run: hide,
});
onBeforeUnmount(() => {
  abort.abort();
  hide();
});
</script>
<template>
  <section
    class="token"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiField v-if="token" v-slot="{ control }" label="Токен подключения устройств">
      <UiControl
        v-bind="control"
        :value="token"
        readonly
        mono
        autocomplete="off"
        spellcheck="false"
      />
    </UiField>
    <UiButton v-if="token" size="sm" @click="commands.run('ide.hub.token.hide')"
      >Скрыть токен</UiButton
    >
    <UiButton v-else size="sm" :busy="busy" @click="commands.run('ide.hub.token.show')"
      >Показать токен подключения</UiButton
    >
    <UiHint
      >Для добавления машины в настройках Hub локального Projector. Токен скроется через 30
      секунд.</UiHint
    >
    <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
  </section>
</template>
<style scoped>
.token {
  display: grid;
  gap: var(--sp-2);
}
</style>
