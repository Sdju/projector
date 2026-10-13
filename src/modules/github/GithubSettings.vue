<script setup lang="ts">
import UiHeading from "../../common/ui/UiHeading.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiField from "../../common/ui/UiField.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiStack from "../../common/ui/UiStack.vue";

import { onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import { fetchIntegrations, integrationRequest, TokenReveal } from "../integration-api/index.ts";
import type { Integration, DeviceLogin, SecretStorage } from "../integration-api/index.ts";
const github = ref<Integration | null>(null);
const file = ref("");
const secretStorage = ref<SecretStorage>({ backend: "file", reason: "unavailable" });
const enabled = ref(false);
const clientId = ref("");
const directory = ref("");
const token = ref("");
const error = ref("");
const message = ref("");
const busy = ref(false);
const device = ref<DeviceLogin | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const tokenView = ref<InstanceType<typeof TokenReveal> | null>(null);
function cancelDevice() {
  clearTimeout(timer);
  device.value = null;
}
function apply(value: Integration) {
  github.value = value;
  if (!value.connected) tokenView.value?.hide();
  enabled.value = value.enabled;
  clientId.value = value.settings.clientId;
  directory.value = value.settings.directory;
}
async function action(task: () => Promise<void>) {
  error.value = "";
  message.value = "";
  busy.value = true;
  try {
    await task();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Ошибка интеграции";
  } finally {
    busy.value = false;
  }
}
onMounted(() =>
  action(async () => {
    const data = await fetchIntegrations();
    file.value = data.file;
    secretStorage.value = data.secretStorage;
    const integration = data.integrations.find((item) => item.id === "github");
    if (integration) apply(integration);
  }),
);
onBeforeUnmount(() => {
  disposed = true;
  cancelDevice();
});
async function save(enableIntegration = enabled.value) {
  cancelDevice();
  apply(
    await integrationRequest<Integration>("/github", "PUT", {
      enabled: enableIntegration,
      clientId: clientId.value,
      directory: directory.value,
    }),
  );
}
async function poll(login: DeviceLogin) {
  if (disposed || device.value?.id !== login.id) return;
  try {
    const result = await integrationRequest<{
      pending: boolean;
      interval?: number;
      integration?: Integration;
    }>("/github/device/poll", "POST", { id: login.id });
    if (disposed || device.value?.id !== login.id) return;
    if (result.pending) timer = setTimeout(() => void poll(login), (result.interval || 5) * 1000);
    else {
      if (result.integration) apply(result.integration);
      cancelDevice();
      message.value = "GitHub подключён";
    }
  } catch (err) {
    if (!disposed && device.value?.id === login.id) {
      cancelDevice();
      error.value = err instanceof Error ? err.message : "Ошибка входа";
    }
  }
}
function login() {
  return action(async () => {
    await save();
    const data = await integrationRequest<DeviceLogin>("/github/device", "POST");
    device.value = data;
    timer = setTimeout(() => void poll(data), data.interval * 1000);
  });
}
function connectToken() {
  if (busy.value || !token.value.trim()) return;
  return action(async () => {
    await save(true);
    apply(await integrationRequest<Integration>("/github/auth", "POST", { token: token.value }));
    token.value = "";
    message.value = "GitHub подключён";
  });
}
function disconnect() {
  return action(async () => {
    cancelDevice();
    apply(await integrationRequest<Integration>("/github/auth", "DELETE"));
    token.value = "";
    message.value = "GitHub отключён";
  });
}
</script>

<template>
  <section class="integrations">
    <article v-if="github" class="plugin">
      <UiInline as="header" :gap="3" justify="between" wrap>
        <UiHeading as="h3" :space-after="0">Подключение</UiHeading>
        <span class="status">{{
          github.connected ? `подключён · ${github.account}` : "не подключён"
        }}</span>
      </UiInline>
      <UiStack
        as="form"
        align="start"
        @submit.prevent="
          action(async () => {
            await save();
            message = 'Настройки сохранены';
          })
        "
      >
        <UiInline as="label" class="toggle" justify="normal"
          ><UiControl v-model="enabled" type="checkbox" :disabled="busy" /> включить
          интеграцию</UiInline
        >
        <UiField v-slot="{ control }" layout="plain" label="Папка для импорта">
          <UiControl
            v-bind="control"
            v-model="directory"
            :disabled="busy"
            placeholder="~/Projects"
            required
        /></UiField>
        <UiField v-slot="{ control }" layout="plain" label="Client ID для входа через браузер">
          <UiControl
            v-bind="control"
            v-model="clientId"
            :disabled="busy"
            placeholder="Client ID вашей GitHub OAuth App"
            autocomplete="off"
        /></UiField>
        <p class="muted help">
          Для входа по коду создайте
          <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer"
            >OAuth App</a
          >
          и включите Device Flow. Client secret не нужен. Можно также подключиться токеном ниже.
        </p>
        <UiButton type="submit" :disabled="busy">сохранить настройки</UiButton>
      </UiStack>
      <TokenReveal
        v-if="github.connected && secretStorage.backend === 'keyring'"
        ref="tokenView"
        integration="github"
        label="Токен GitHub"
        :disabled="busy"
        @error="error = $event"
      />
      <UiInline class="actions" :gap="3" wrap>
        <UiButton :disabled="busy || !enabled || !clientId.trim() || !!device" @click="login"
          >войти через GitHub</UiButton
        >
        <UiButton v-if="github.connected" :disabled="busy" @click="disconnect">выйти</UiButton>
      </UiInline>
      <div v-if="device" class="device" role="status">
        <p>
          Введите код <strong>{{ device.userCode }}</strong> на странице GitHub.
        </p>
        <a :href="device.verificationUri" target="_blank" rel="noopener noreferrer"
          >открыть GitHub для входа ↗</a
        >
        <p class="muted">Ожидаем подтверждения…</p>
        <UiButton @click="cancelDevice">отменить</UiButton>
      </div>
      <details>
        <summary>Войти с Personal Access Token</summary>
        <UiStack as="form" align="start" @submit.prevent="connectToken">
          <p class="muted help">
            Fine-grained token: доступ к нужным репозиториям и Contents: read. Для classic token и
            приватных репозиториев — scope repo.
          </p>
          <p class="muted help">Подключение токеном автоматически включит интеграцию.</p>
          <UiField v-slot="{ control }" layout="plain" label="Токен GitHub">
            <UiControl
              v-bind="control"
              v-model="token"
              type="password"
              autocomplete="off"
              :disabled="busy"
              placeholder="github_pat_…"
              required
          /></UiField>
          <UiButton type="submit" :disabled="busy || !token.trim()">подключить GitHub</UiButton>
        </UiStack>
      </details>
    </article>
    <details class="storage">
      <summary>Хранение настроек и авторизации</summary>
      <p class="muted">
        Настройки и авторизация хранятся в файле <code>{{ file || "integrations.json" }}</code
        >.
        <template v-if="secretStorage.backend === 'keyring'">
          Токены и ключи — в системном хранилище секретов (Secret Service), в файле их нет.
        </template>
        <template v-else-if="secretStorage.reason === 'disabled'">
          Хранилище секретов отключено (<code>PROJECTOR_SECRET_STORE=file</code>): токены лежат в
          этом файле.
        </template>
        <template v-else>
          Системное хранилище секретов недоступно: токены лежат в этом файле с правами 0600.
        </template>
      </p>
    </details>
    <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
    <p v-if="message" class="muted" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.integrations {
  margin: 0;
}
.plugin {
  padding: 0;
}
.status,
.muted {
  color: var(--muted);
  font-size: var(--fs-xs);
}
code {
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
}
form > label,
form > p {
  width: 100%;
}
label {
  font-size: var(--fs-sm);
}
.field {
  color: inherit;
  min-width: auto;
}

.help {
  margin: 0;
}
.actions,
details,
.device {
  margin-top: var(--sp-4);
}
summary {
  cursor: pointer;
  color: var(--muted);
  font-size: var(--fs-sm);
  margin-bottom: var(--sp-3);
}
a {
  text-decoration: underline;
}
.link {
  display: inline-block;
  margin-top: var(--sp-4);
  font-size: var(--fs-sm);
}
.device {
  padding: var(--sp-3);
  background: var(--bg-2);
}
.device strong {
  font-family: var(--mono);
}
</style>
