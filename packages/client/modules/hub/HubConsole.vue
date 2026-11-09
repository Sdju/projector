<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick } from "vue";
import { isDeviceId, hubReturnPath, type HubDevice } from "@projector/core/modules/hub/index.ts";
import { useCommandScope, commandArgs } from "../../common/utilities/commands.ts";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiCard from "../../common/ui/UiCard.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiField from "../../common/ui/UiField.vue";
import UiControl, { type UiControlHandle } from "../../common/ui/UiControl.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiStatusDot from "../../common/ui/UiStatusDot.vue";
import UiSpinner from "../../common/ui/UiSpinner.vue";
import { hubRequest, logoutHub } from "./client.ts";

const authenticated = ref(false);
const loading = ref(true);
const busy = ref(false);
const refreshing = ref(false);
const error = ref("");
const password = ref("");
const input = ref<UiControlHandle>();
const devices = ref<HubDevice[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
const next = hubReturnPath(new URLSearchParams(location.search).get("next"));
const commands = useCommandScope("hub", () => ({
  surface: "hub",
  authenticated: authenticated.value,
}));
async function refresh() {
  if (refreshing.value || disposed) return;
  refreshing.value = true;
  try {
    const session = await hubRequest<{ authenticated: boolean }>("/api/hub/session");
    if (disposed) return;
    authenticated.value = session.authenticated;
    if (!session.authenticated) return;
    const result = await hubRequest<{ devices: HubDevice[] }>("/api/hub/devices");
    if (!disposed) {
      devices.value = result.devices;
      error.value = "";
    }
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : "Hub недоступен";
  } finally {
    refreshing.value = false;
  }
}
async function login() {
  if (busy.value || !password.value) return;
  busy.value = true;
  error.value = "";
  try {
    await hubRequest("/api/hub/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    password.value = "";
    location.assign(next);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось войти";
  } finally {
    busy.value = false;
    if (error.value) {
      await nextTick();
      input.value?.focus();
      input.value?.select();
    }
  }
}
commands.scope.registerCommand({
  id: "ide.hub.login",
  title: "Войти в Hub",
  description: "Проверяет пароль и открывает устройства или страницу, с которой был запрошен вход.",
  enabled: () => !busy.value && !!password.value,
  run: login,
});
commands.scope.registerCommand({
  id: "ide.hub.devices.refresh",
  title: "Обновить устройства Hub",
  description: "Перечитывает список устройств и состояние их подключений.",
  enabled: () => authenticated.value && !refreshing.value,
  run: refresh,
});
commands.scope.registerCommand({
  id: "ide.hub.device.open",
  title: "Открыть устройство",
  description: "Открывает Projector на подключённой машине в отдельном контексте страницы.",
  arguments: { deviceId: "string: id подключённого устройства" },
  run: (value) => {
    const { deviceId } = commandArgs(value);
    if (
      !isDeviceId(deviceId) ||
      !devices.value.some((device) => device.id === deviceId && device.online)
    )
      throw new Error("Устройство недоступно");
    location.assign(`/devices/${deviceId}/`);
  },
});
commands.scope.registerCommand({
  id: "ide.hub.logout",
  title: "Выйти из Hub",
  description:
    "Отзывает текущую сессию браузера и закрывает её соединения с устройствами. Задания и терминалы остаются на устройствах.",
  run: async () => {
    try {
      await logoutHub();
    } catch {
      error.value = "Не удалось выйти. Повторите попытку.";
    }
  },
});
onMounted(async () => {
  await refresh();
  if (disposed) return;
  loading.value = false;
  if (authenticated.value && location.pathname === "/login" && next !== "/") {
    location.replace(next);
    return;
  }
  await nextTick();
  input.value?.focus();
  timer = setInterval(() => {
    if (authenticated.value) void refresh();
  }, 5000);
});
onBeforeUnmount(() => {
  disposed = true;
  clearInterval(timer);
});
</script>
<template>
  <main
    class="hub"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <div class="content">
      <header class="brand">
        <img src="/favicon.svg" alt="" width="28" height="28" /><span
          >projector<span class="hub-label">hub</span></span
        >
      </header>
      <UiCard class="panel">
        <UiSpinner v-if="loading" label="Подключение к Hub" />
        <template v-else-if="!authenticated">
          <UiHeading as="h1" size="lg">Вход в Hub</UiHeading>
          <UiHint>Войдите, чтобы открыть Projector на подключённых устройствах.</UiHint>
          <form class="login" @submit.prevent="commands.run('ide.hub.login')">
            <UiField v-slot="{ control }" label="Пароль" required>
              <UiControl
                v-bind="control"
                ref="input"
                v-model="password"
                type="password"
                autocomplete="current-password"
                :disabled="busy"
              />
            </UiField>
            <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
            <UiButton type="submit" appearance="solid" :busy="busy" :disabled="!password"
              >Войти</UiButton
            >
          </form>
        </template>
        <template v-else>
          <UiInline justify="between"
            ><UiHeading as="h1">Устройства</UiHeading
            ><UiButton size="sm" appearance="quiet" @click="commands.run('ide.hub.logout')"
              >Выйти</UiButton
            ></UiInline
          >
          <UiHint>Выберите машину, с которой хотите работать.</UiHint>
          <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
          <div class="devices" aria-label="Устройства Hub">
            <UiButton
              v-for="device in devices"
              :key="device.id"
              class="device"
              :disabled="!device.online"
              @click="commands.run('ide.hub.device.open', { deviceId: device.id })"
            >
              <UiStatusDot :tone="device.online ? 'success' : 'muted'" />
              <strong>{{ device.name }}</strong
              ><span class="device-state">{{ device.online ? "Подключено" : "Не в сети" }}</span>
            </UiButton>
            <UiHint v-if="!devices.length" class="empty"
              >Нет подключённых устройств. Откройте настройки Hub в локальном Projector, чтобы
              подключить машину.</UiHint
            >
          </div>
          <UiButton size="sm" :busy="refreshing" @click="commands.run('ide.hub.devices.refresh')"
            >Обновить</UiButton
          >
        </template>
      </UiCard>
      <UiHint class="footer">Ваши проекты и задания остаются на ваших устройствах.</UiHint>
    </div>
  </main>
</template>
<style scoped>
.hub {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: var(--sp-5);
  background: var(--bg);
}
.content {
  width: min(100%, 440px);
  display: grid;
  gap: var(--sp-5);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--text);
  font-size: var(--fs-lg);
  font-weight: 600;
}
.hub-label {
  margin-left: var(--sp-2);
  color: var(--muted);
  font-weight: 400;
}
.panel {
  gap: var(--sp-4);
  padding: var(--sp-5);
  color: var(--text);
}
.login {
  display: grid;
  gap: var(--sp-4);
}
.devices {
  display: grid;
  gap: var(--sp-2);
}
.device {
  justify-content: flex-start;
  min-height: 48px;
  gap: var(--sp-3);
}
.device-state {
  margin-left: auto;
  font-size: var(--fs-2xs);
  color: var(--muted);
}
.empty {
  padding: var(--sp-3) 0;
}
.footer {
  text-align: center;
}
</style>
