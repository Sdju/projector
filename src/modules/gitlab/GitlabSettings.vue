<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import { fetchIntegrations, integrationRequest, TokenReveal } from "../integration-api/index.ts";
import type { Integration, SecretStorage } from "../integration-api/index.ts";

const gitlab = ref<Integration | null>(null);
const secretStorage = ref<SecretStorage>({ backend: "file", reason: "unavailable" });
const enabled = ref(false);
const url = ref("");
const directory = ref("");
const token = ref("");
const repository = ref("");
const error = ref("");
const message = ref("");
const busy = ref(false);
const tokenView = ref<InstanceType<typeof TokenReveal> | null>(null);
function apply(value: Integration) {
  gitlab.value = value;
  if (!value.connected) tokenView.value?.hide();
  enabled.value = value.enabled;
  url.value = value.settings.url ?? "";
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
    secretStorage.value = data.secretStorage;
    const integration = data.integrations.find((item) => item.id === "gitlab");
    if (integration) apply(integration);
  }),
);

async function save(enable = enabled.value) {
  apply(
    await integrationRequest<Integration>("/gitlab", "PUT", {
      enabled: enable,
      url: url.value,
      directory: directory.value,
    }),
  );
}

const commands = useCommandScope("gitlab-settings", () => ({ surface: "gitlab-integration" }));
commands.scope.registerCommand({
  id: "ide.gitlab.integration.save",
  title: "Сохранить настройки GitLab",
  description: "Сохраняет адрес GitLab, папку импорта и состояние интеграции.",
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
  run: () =>
    action(async () => {
      await save(true);
      apply(await integrationRequest<Integration>("/gitlab/auth", "POST", { token: token.value }));
      token.value = "";
      message.value = "GitLab подключён";
    }),
});
commands.scope.registerCommand({
  id: "ide.gitlab.integration.disconnect",
  title: "Отключить GitLab",
  description: "Удаляет сохранённый токен GitLab из Projector.",
  enabled: () => !busy.value && !!gitlab.value?.connected,
  run: () =>
    action(async () => {
      apply(await integrationRequest<Integration>("/gitlab/auth", "DELETE"));
      message.value = "GitLab отключён";
    }),
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
      <header>
        <h3>Подключение</h3>
        <span class="status">{{
          gitlab.connected ? `подключён · ${gitlab.account}` : "не подключён"
        }}</span>
      </header>
      <form @submit.prevent="commands.run('ide.gitlab.integration.save')">
        <label class="toggle"
          ><input v-model="enabled" type="checkbox" :disabled="busy" /> включить интеграцию</label
        >
        <label
          >Адрес GitLab<input
            v-model="url"
            :disabled="busy"
            placeholder="https://gitlab.com"
            autocomplete="off"
            required
        /></label>
        <label
          >Папка для импорта<input
            v-model="directory"
            :disabled="busy"
            placeholder="~/Projects"
            required
        /></label>
        <p class="muted help">
          Для self-hosted укажите адрес вашего сервера. Смена адреса сбрасывает сохранённый токен.
        </p>
        <UiButton type="submit" data-command="ide.gitlab.integration.save" :disabled="busy"
          >сохранить настройки</UiButton
        >
      </form>
      <TokenReveal
        v-if="gitlab.connected && secretStorage.backend === 'keyring'"
        ref="tokenView"
        integration="gitlab"
        label="Токен GitLab"
        :disabled="busy"
        @error="error = $event"
      />
      <form class="block" @submit.prevent="commands.run('ide.gitlab.integration.connect')">
        <p class="muted help">
          Personal Access Token со scope <code>read_api</code> и <code>read_repository</code>
          (<code>{{ url || "https://gitlab.com" }}/-/user_settings/personal_access_tokens</code>).
          Подключение токеном автоматически включит интеграцию.
        </p>
        <label
          >Токен GitLab<input
            v-model="token"
            type="password"
            autocomplete="off"
            :disabled="busy"
            placeholder="glpat-…"
            required
        /></label>
        <div class="actions">
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
        </div>
      </form>
      <form
        v-if="gitlab.connected"
        class="block"
        @submit.prevent="commands.run('ide.gitlab.repository.import')"
      >
        <label
          >Клонировать проект<input
            v-model="repository"
            :disabled="busy"
            placeholder="group/project или ссылка"
            autocomplete="off"
        /></label>
        <p class="muted help">
          Также доступно в палитре: введите <code>gl/</code> и название проекта.
        </p>
        <UiButton
          type="submit"
          data-command="ide.gitlab.repository.import"
          :disabled="busy || !repository.trim()"
          >клонировать</UiButton
        >
      </form>
    </article>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="muted" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.integrations {
  margin: 0;
}
h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
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
  font-size: var(--fs-xs);
}
code {
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
}
form {
  display: grid;
  gap: var(--sp-3);
  justify-items: start;
}
form.block {
  margin-top: var(--sp-4);
}
form > label,
form > p {
  width: 100%;
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
.error {
  color: var(--err);
}
</style>
