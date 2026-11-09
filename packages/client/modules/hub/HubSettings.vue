<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from "vue";
import { isDeviceId } from "@projector/core/modules/hub/index.ts";
import { deviceBase } from "../../common/utilities/device-url.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiField from "../../common/ui/UiField.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiStatusDot from "../../common/ui/UiStatusDot.vue";
import { hubRequest } from "./client.ts";
interface State {
  enabled: boolean;
  online: boolean;
  url?: string;
  deviceId?: string;
  error?: string;
}
const state = shallowRef<State>();
const url = ref("");
const deviceId = ref("");
const token = ref("");
const remote = !!deviceBase();
const { ready, busy, error, status, load, perform } = useSectionAction();
const commands = useCommandScope("hub-settings", () => ({
  surface: "hub-settings",
  online: state.value?.online ?? false,
}));
let timer: ReturnType<typeof setInterval> | undefined;
const abort = new AbortController();
const valid = computed(
  () =>
    !!url.value.trim() &&
    isDeviceId(deviceId.value) &&
    (!!token.value || (state.value?.enabled && url.value.replace(/\/$/, "") === state.value.url)),
);
async function refresh(initial = false) {
  const data = await hubRequest<State>("/api/hub", { signal: abort.signal });
  if (abort.signal.aborted) return;
  state.value = data;
  if (initial) {
    url.value = data.url ?? "";
    deviceId.value = data.deviceId ?? "";
  }
}
async function save() {
  await perform(
    async () => {
      const data = await hubRequest<State>("/api/hub", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.value.trim(),
          deviceId: deviceId.value,
          token: token.value,
        }),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      state.value = data;
      url.value = data.url ?? url.value;
      token.value = "";
    },
    { errorFallback: "Не удалось подключиться к Hub", success: "Подключение сохранено" },
  );
}
commands.scope.registerCommand({
  id: "ide.hub.connection.save",
  title: "Подключить Projector к Hub",
  description:
    "Сохраняет адрес Hub, id устройства и токен на локальной машине и запускает исходящее соединение без перезапуска терминалов.",
  enabled: () => ready.value && !busy.value && !!valid.value,
  run: save,
});
commands.scope.registerCommand({
  id: "ide.hub.connection.disconnect",
  title: "Отключить Projector от Hub",
  description:
    "Останавливает туннель и удаляет сохранённые credentials. Локальные терминалы и задания продолжают работать.",
  enabled: () => !busy.value && !!state.value?.enabled,
  run: () =>
    perform(
      async () => {
        const data = await hubRequest<State>("/api/hub", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          state.value = data;
          token.value = "";
        }
      },
      { errorFallback: "Не удалось отключиться", success: "Устройство отключено от Hub" },
    ),
});
commands.scope.registerCommand({
  id: "ide.hub.open",
  title: "Открыть Hub",
  description: "Открывает интерфейс настроенного Hub в новой вкладке браузера.",
  enabled: () => !!state.value?.url,
  run: () => {
    if (state.value?.url) window.open(state.value.url, "_blank", "noopener,noreferrer");
  },
});
onMounted(async () => {
  if (remote) return;
  await load(() => refresh(true), "Не удалось загрузить подключение Hub");
  if (!abort.signal.aborted)
    timer = setInterval(() => {
      if (!busy.value) void refresh().catch(() => {});
    }, 3000);
});
onBeforeUnmount(() => {
  abort.abort();
  clearInterval(timer);
});
</script>
<template>
  <section
    class="settings"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiHeading as="h2" size="sm">Подключение к Hub</UiHeading>
    <UiHint v-if="remote">Подключение управляется в локальном Projector на этой машине.</UiHint>
    <template v-else>
      <UiHint
        >Hub даёт доступ к этой машине через общий веб-интерфейс. Локальный сервер остаётся
        доступным по своему адресу.</UiHint
      >
      <UiInline v-if="state" role="status"
        ><UiStatusDot :tone="state.online ? 'success' : state.enabled ? 'warning' : 'muted'" />{{
          state.online ? "Подключено" : state.enabled ? "Ожидание подключения" : "Не подключено"
        }}</UiInline
      >
      <UiMessage v-if="state?.error" tone="danger" role="status">{{ state.error }}</UiMessage>
      <form class="form" @submit.prevent="commands.run('ide.hub.connection.save')">
        <UiField
          v-slot="{ control }"
          label="Адрес Hub"
          hint="HTTPS-адрес; для localhost также разрешён HTTP."
          required
        >
          <UiControl
            v-bind="control"
            v-model="url"
            type="url"
            placeholder="https://hub.example.com"
            :disabled="busy"
          />
        </UiField>
        <UiField
          v-slot="{ control }"
          label="ID устройства"
          hint="Латинские строчные буквы, цифры и дефис. Стабильное имя этой машины."
          required
        >
          <UiControl
            v-bind="control"
            v-model="deviceId"
            pattern="[a-z0-9][a-z0-9-]{0,62}"
            maxlength="63"
            placeholder="workstation"
            :disabled="busy"
          />
        </UiField>
        <UiField
          v-slot="{ control }"
          label="Токен подключения"
          :hint="
            state?.enabled
              ? 'Оставьте пустым, чтобы сохранить существующий токен для этого Hub.'
              : 'Токен устройства, настроенный на Hub; отличается от пароля входа.'
          "
        >
          <UiControl
            v-bind="control"
            v-model="token"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
          />
        </UiField>
        <UiInline wrap>
          <UiButton type="submit" appearance="solid" :busy="busy" :disabled="!ready || !valid">{{
            state?.enabled ? "Сохранить" : "Подключить"
          }}</UiButton>
          <UiButton
            v-if="state?.enabled"
            :disabled="busy"
            @click="commands.run('ide.hub.connection.disconnect')"
            >Отключить</UiButton
          >
          <UiButton v-if="state?.url" @click="commands.run('ide.hub.open')">Открыть Hub</UiButton>
        </UiInline>
      </form>
      <UiMessage v-if="error || status" :tone="error ? 'danger' : undefined" role="status">{{
        error || status
      }}</UiMessage>
    </template>
  </section>
</template>
<style scoped>
.settings,
.form {
  display: grid;
  gap: var(--sp-4);
}
.form {
  max-width: 480px;
}
</style>
