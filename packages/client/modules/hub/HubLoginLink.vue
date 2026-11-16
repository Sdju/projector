<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiField from "../../common/ui/UiField.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { hubRequest } from "./client.ts";
import { loginQrSvg } from "./qr.ts";

const props = withDefaults(defineProps<{ available?: boolean }>(), { available: true });
const url = ref("");
const ttl = ref(60);
const busy = ref(false);
const error = ref("");
const abort = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
const commands = useCommandScope("hub-login-link", () => ({
  surface: "hub",
  available: props.available,
}));
const qr = computed(() => (url.value ? loginQrSvg(url.value) : ""));
function hide() {
  clearTimeout(timer);
  url.value = "";
}
commands.scope.registerCommand({
  id: "ide.hub.loginQr.show",
  title: "Показать QR-код входа в Hub",
  description:
    "Запрашивает одноразовую ссылку входа и показывает QR-код, чтобы открыть Hub с телефона без пароля.",
  enabled: () => props.available && !busy.value && !url.value,
  run: async () => {
    busy.value = true;
    error.value = "";
    try {
      const data = await hubRequest<{ url: string; ttl: number }>("/api/hub/login-link", {
        method: "POST",
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      url.value = data.url;
      ttl.value = data.ttl;
      timer = setTimeout(hide, data.ttl * 1000);
    } catch (cause) {
      if (!abort.signal.aborted)
        error.value = cause instanceof Error ? cause.message : "Не удалось получить ссылку входа.";
    } finally {
      busy.value = false;
    }
  },
});
commands.scope.registerCommand({
  id: "ide.hub.loginQr.hide",
  title: "Скрыть QR-код входа в Hub",
  description: "Убирает показанный QR-код и ссылку входа с экрана.",
  enabled: () => !!url.value,
  run: hide,
});
onBeforeUnmount(() => {
  abort.abort();
  hide();
});
</script>
<template>
  <section
    class="login-link"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <div v-if="url" class="preview">
      <div class="qr" role="img" aria-label="QR-код входа в Hub" v-html="qr" />
      <UiField v-slot="{ control }" label="Ссылка входа">
        <UiControl
          v-bind="control"
          :value="url"
          readonly
          mono
          autocomplete="off"
          spellcheck="false"
        />
      </UiField>
    </div>
    <UiButton v-if="url" size="sm" @click="commands.run('ide.hub.loginQr.hide')"
      >Скрыть QR-код</UiButton
    >
    <UiButton
      v-else
      size="sm"
      :busy="busy"
      :disabled="!available"
      @click="commands.run('ide.hub.loginQr.show')"
      >Показать QR-код входа</UiButton
    >
    <UiHint v-if="url"
      >Отсканируйте телефоном, чтобы войти без пароля. Ссылка одноразовая и скроется через
      {{ ttl }} секунд.</UiHint
    >
    <UiHint v-else-if="available"
      >Телефон откроет Hub по одноразовой ссылке, пароль браузера вводить не нужно.</UiHint
    >
    <UiHint v-else>Подключите Hub, чтобы показать QR-код входа с телефона.</UiHint>
    <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
  </section>
</template>
<style scoped>
.login-link {
  display: grid;
  gap: var(--sp-2);
}
.preview {
  display: grid;
  gap: var(--sp-3);
  justify-items: start;
}
.qr {
  width: min(100%, 220px);
  padding: var(--sp-2);
  background: #fff;
  border-radius: var(--r-sm);
}
.qr :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
