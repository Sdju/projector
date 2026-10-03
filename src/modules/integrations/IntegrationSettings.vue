<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import { fetchIntegrations, integrationRequest } from "./client.ts";
import type { Integration, DeviceLogin } from "./client.ts";
import { DockerSettings } from "../docker/index.ts";
const github = ref<Integration | null>(null);
const file = ref("");
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
function cancelDevice() {
  clearTimeout(timer);
  device.value = null;
}
function apply(value: Integration) {
  github.value = value;
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
    <h2>Интеграции</h2>
    <p class="muted">
      Настройки и авторизация хранятся в файле <code>{{ file || "integrations.json" }}</code
      >.
    </p>
    <DockerSettings />
    <article v-if="github" class="plugin">
      <header>
        <h3>GitHub</h3>
        <span class="status">{{
          github.connected ? `подключён · ${github.account}` : "не подключён"
        }}</span>
      </header>
      <p class="muted">Импорт публичных и приватных репозиториев, доступных вашему аккаунту.</p>
      <form
        @submit.prevent="
          action(async () => {
            await save();
            message = 'Настройки сохранены';
          })
        "
      >
        <label class="toggle"
          ><input v-model="enabled" type="checkbox" :disabled="busy" /> включить интеграцию</label
        >
        <label
          >Папка для импорта<input
            v-model="directory"
            :disabled="busy"
            placeholder="~/Projects"
            required
        /></label>
        <label
          >Client ID для входа через браузер<input
            v-model="clientId"
            :disabled="busy"
            placeholder="Client ID вашей GitHub OAuth App"
            autocomplete="off"
        /></label>
        <p class="muted help">
          Для входа по коду создайте
          <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer"
            >OAuth App</a
          >
          и включите Device Flow. Client secret не нужен. Можно также подключиться токеном ниже.
        </p>
        <UiButton type="submit" :disabled="busy">сохранить настройки</UiButton>
      </form>
      <div class="actions">
        <UiButton :disabled="busy || !enabled || !clientId.trim() || !!device" @click="login"
          >войти через GitHub</UiButton
        >
        <UiButton v-if="github.connected" :disabled="busy" @click="disconnect">выйти</UiButton>
      </div>
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
        <form @submit.prevent="connectToken">
          <p class="muted help">
            Fine-grained token: доступ к нужным репозиториям и Contents: read. Для classic token и
            приватных репозиториев — scope repo.
          </p>
          <p class="muted help">Подключение токеном автоматически включит интеграцию.</p>
          <label
            >Токен GitHub<input
              v-model="token"
              type="password"
              autocomplete="off"
              :disabled="busy"
              placeholder="github_pat_…"
              required
          /></label>
          <UiButton type="submit" :disabled="busy || !token.trim()">подключить GitHub</UiButton>
        </form>
      </details>
      <router-link v-if="github.enabled && github.connected" to="/projects" class="link"
        >перейти к импорту проектов →</router-link
      >
    </article>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="muted" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.integrations {
  margin: var(--sp-6) 0;
}
h2 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-lg);
  font-weight: 500;
}
h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
}
.plugin {
  border: 1px solid var(--line);
  padding: var(--sp-4);
  border-radius: var(--r-sm);
}
header,
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
.status,
.muted {
  color: var(--muted);
  font-size: var(--fs-sm);
}
code {
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
}
form {
  display: grid;
  gap: var(--sp-3);
}
label {
  display: grid;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
}
.toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.toggle input {
  width: auto;
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
.error {
  color: var(--err);
}
.device {
  padding: var(--sp-3);
  background: var(--bg-2);
}
.device strong {
  font-family: var(--mono);
}
</style>
