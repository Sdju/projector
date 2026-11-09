<script setup lang="ts">
import UiHeading from "../../common/ui/UiHeading.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiField from "../../common/ui/UiField.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiStack from "../../common/ui/UiStack.vue";

import { computed, onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import {
  DeviceLoginPanel,
  fetchIntegrations,
  integrationRequest,
  TokenReveal,
  useDeviceLogin,
  useIntegrationOperation,
} from "../integration-api/index.ts";
import type { Integration, SecretStorage } from "../integration-api/index.ts";

const gitlab = ref<Integration | null>(null);
const secretStorage = ref<SecretStorage>({ backend: "file", reason: "unavailable" });
const enabled = ref(false);
const clientId = ref("");
const url = ref("");
const directory = ref("");
const token = ref("");
const hasClientId = computed(() => (clientId.value ?? "").trim().length > 0);
const repository = ref("");
const { error, message, busy, action } = useIntegrationOperation();
const tokenView = ref<InstanceType<typeof TokenReveal> | null>(null);
function apply(value: Integration) {
  gitlab.value = value;
  if (!value.connected) tokenView.value?.hide();
  enabled.value = value.enabled;
  clientId.value = value.settings.clientId ?? "";
  url.value = value.settings.url ?? "";
  directory.value = value.settings.directory;
}
onMounted(() =>
  action(async () => {
    const data = await fetchIntegrations();
    secretStorage.value = data.secretStorage;
    const integration = data.integrations.find((item) => item.id === "gitlab");
    if (integration) apply(integration);
  }).catch(() => {
    /* Initial load failures are shown by the form. */
  }),
);
const {
  device,
  start: login,
  cancel: cancelDevice,
} = useDeviceLogin({
  endpoint: "/gitlab/device",
  pollEndpoint: "/gitlab/device/poll",
  connectedMessage: "GitLab подключён",
  save: () => save(),
  apply,
  error,
  message,
  action,
});

async function save(enable = enabled.value) {
  cancelDevice();
  apply(
    await integrationRequest<Integration>("/gitlab", "PUT", {
      enabled: enable,
      clientId: clientId.value,
      url: url.value,
      directory: directory.value,
    }),
  );
}
function connectToken() {
  if (busy.value || !token.value.trim()) return;
  return action(async () => {
    cancelDevice();
    await save(true);
    apply(
      await integrationRequest<Integration>("/gitlab/auth", "POST", {
        token: token.value.trim(),
      }),
    );
    token.value = "";
    message.value = "GitLab подключён";
  });
}
function disconnect() {
  return action(async () => {
    cancelDevice();
    apply(await integrationRequest<Integration>("/gitlab/auth", "DELETE"));
    message.value = "GitLab отключён";
  });
}

const commands = useCommandScope("gitlab-settings", () => ({
  surface: "settings",
  integration: "gitlab",
}));
commands.scope.registerCommand({
  id: "ide.gitlab.integration.save",
  title: "Сохранить настройки GitLab",
  description:
    "Сохраняет адрес GitLab, Client ID OAuth-приложения, папку импорта и состояние интеграции.",
  enabled: () => !busy.value && !!gitlab.value,
  run: () =>
    action(async () => {
      await save();
      message.value = "Настройки сохранены";
    }),
});
commands.scope.registerCommand({
  id: "ide.gitlab.integration.connect",
  title: "Подключить GitLab",
  description:
    "Подключает GitLab по Personal Access Token (scope read_api и read_repository), введённому в форме.",
  enabled: () => !busy.value && !!token.value.trim(),
  run: connectToken,
});
commands.scope.registerCommand({
  id: "ide.gitlab.integration.disconnect",
  title: "Отключить GitLab",
  description: "Удаляет сохранённый токен GitLab из Projector.",
  enabled: () => !busy.value && !!gitlab.value?.connected,
  run: disconnect,
});
commands.scope.registerCommand({
  id: "ide.gitlab.integration.device.start",
  title: "Войти в GitLab через браузер",
  description:
    "Сохраняет настройки и получает код GitLab Device Flow для подтверждения в браузере (GitLab 17.1+).",
  enabled: () => !busy.value && enabled.value && hasClientId.value && !device.value,
  run: login,
});
commands.scope.registerCommand({
  id: "ide.gitlab.integration.device.cancel",
  title: "Отменить вход в GitLab",
  description: "Прекращает ожидание подтверждения текущего входа GitLab Device Flow.",
  enabled: () => !!device.value,
  run: cancelDevice,
});
commands.scope.registerCommand({
  id: "ide.gitlab.repository.import",
  title: "Клонировать проект GitLab",
  description:
    "Клонирует проект GitLab (group/project или ссылка) в папку импорта и добавляет его в каталог проектов.",
  arguments: { repository: "group/project или ссылка на проект GitLab" },
  enabled: () => !busy.value && !!gitlab.value?.connected,
  run: (value) =>
    action(async () => {
      const name = String(commandArgs(value).repository ?? repository.value).trim();
      if (!name) throw new Error("Укажите проект GitLab");
      const data = await integrationRequest<{ project: { name: string } }>(
        "/gitlab/import",
        "POST",
        { repository: name },
      );
      repository.value = "";
      message.value = `Проект ${data.project.name} клонирован и добавлен`;
    }),
});
</script>

<template>
  <section class="integrations">
    <article v-if="gitlab" class="plugin">
      <UiInline as="header" :gap="3" justify="between" wrap>
        <UiHeading as="h3" :space-after="0">Подключение</UiHeading>
        <span class="status">{{
          gitlab.connected
            ? `подключён${gitlab.auth === "oauth" ? " · OAuth" : " · PAT"} · ${gitlab.account}`
            : "не подключён"
        }}</span>
      </UiInline>
      <UiStack
        as="form"
        align="start"
        @submit.prevent="commands.run('ide.gitlab.integration.save')"
      >
        <UiInline as="label" class="toggle" justify="normal"
          ><UiControl v-model="enabled" type="checkbox" :disabled="busy" /> включить
          интеграцию</UiInline
        >
        <UiField v-slot="{ control }" layout="plain" label="Адрес GitLab">
          <UiControl
            v-bind="control"
            v-model="url"
            :disabled="busy"
            placeholder="https://gitlab.com"
            autocomplete="off"
            required
        /></UiField>
        <UiField v-slot="{ control }" layout="plain" label="Client ID для входа через браузер">
          <UiControl
            v-bind="control"
            v-model="clientId"
            :disabled="busy"
            placeholder="Client ID OAuth-приложения GitLab"
            autocomplete="off"
        /></UiField>
        <UiField v-slot="{ control }" layout="plain" label="Папка для импорта">
          <UiControl
            v-bind="control"
            v-model="directory"
            :disabled="busy"
            placeholder="~/Projects"
            required
        /></UiField>
        <p class="muted help">
          Для self-hosted укажите адрес вашего сервера. Смена адреса сбрасывает сохранённый токен.
          Для входа через браузер создайте
          <a
            :href="`${url || 'https://gitlab.com'}/-/user_settings/applications`"
            target="_blank"
            rel="noopener noreferrer"
            >OAuth Application</a
          >
          на своём инстансе, включите Device Flow (GitLab 17.1+) и права
          <code>read_api</code>, <code>read_repository</code>, <code>read_user</code>. Client secret
          не нужен. Можно также подключиться токеном ниже.
        </p>
        <UiButton type="submit" data-command="ide.gitlab.integration.save" :disabled="busy"
          >сохранить настройки</UiButton
        >
      </UiStack>
      <TokenReveal
        v-if="gitlab.connected && secretStorage.backend === 'keyring'"
        ref="tokenView"
        integration="gitlab"
        label="Токен GitLab"
        :disabled="busy"
        @error="error = $event"
      />
      <UiInline class="actions" :gap="3" wrap>
        <UiButton
          :disabled="busy || !enabled || !hasClientId || !!device"
          data-command="ide.gitlab.integration.device.start"
          @click="commands.run('ide.gitlab.integration.device.start')"
          >войти через GitLab</UiButton
        >
      </UiInline>
      <DeviceLoginPanel
        v-if="device"
        host="GitLab"
        :device="device"
        command-id="ide.gitlab.integration.device.cancel"
        @cancel="cancelDevice"
      />
      <UiStack
        as="form"
        align="start"
        class="block"
        @submit.prevent="commands.run('ide.gitlab.integration.connect')"
      >
        <p class="muted help">
          Personal Access Token со scope <code>read_api</code> и <code>read_repository</code> (<code
            >{{ url || "https://gitlab.com" }}/-/user_settings/personal_access_tokens</code
          >). Подключение токеном автоматически включит интеграцию.
        </p>
        <UiField v-slot="{ control }" layout="plain" label="Токен GitLab">
          <UiControl
            v-bind="control"
            v-model="token"
            type="password"
            autocomplete="off"
            :disabled="busy"
            placeholder="glpat-…"
            required
        /></UiField>
        <UiInline class="actions" :gap="3" wrap>
          <UiButton
            type="submit"
            data-command="ide.gitlab.integration.connect"
            :disabled="busy || !token.trim()"
            >подключить GitLab</UiButton
          >
          <UiButton
            v-if="gitlab.connected"
            data-command="ide.gitlab.integration.disconnect"
            :disabled="busy"
            @click="commands.run('ide.gitlab.integration.disconnect')"
            >выйти</UiButton
          >
        </UiInline>
      </UiStack>
      <UiStack
        as="form"
        align="start"
        v-if="gitlab.connected"
        class="block"
        @submit.prevent="commands.run('ide.gitlab.repository.import')"
      >
        <UiField v-slot="{ control }" layout="plain" label="Клонировать проект">
          <UiControl
            v-bind="control"
            v-model="repository"
            :disabled="busy"
            placeholder="group/project или ссылка"
            autocomplete="off"
        /></UiField>
        <p class="muted help">
          Также доступно в палитре: введите <code>gl/</code> и название проекта.
        </p>
        <UiButton
          type="submit"
          data-command="ide.gitlab.repository.import"
          :disabled="busy || !repository.trim()"
          >клонировать</UiButton
        >
      </UiStack>
    </article>
    <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
    <p v-if="message" class="muted" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.integrations {
  margin: 0;
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
form.block {
  margin-top: var(--sp-4);
}
form > label,
form > p {
  width: 100%;
}
label {
  font-size: var(--fs-sm);
}
.help {
  margin: 0;
}
.actions {
  margin-top: var(--sp-4);
}
a {
  text-decoration: underline;
}
</style>
