<script setup lang="ts">
import UiLabel from "../../../common/ui/UiLabel.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiHeading from "../../../common/ui/UiHeading.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import { computed, ref, useId } from "vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import {
  fetchIntegrations,
  integrationRequest,
  useIntegrationOperation,
} from "../../integration-api/index.ts";
import { formatProjectRef } from "../../project/index.ts";

const props = defineProps<{ instance: string; path: string }>();
const emit = defineEmits<{ connected: [] }>();
const token = ref("");
const tokenId = useId();
const projectId = formatProjectRef({ kind: "gitlab", instance: props.instance, path: props.path });
const { busy, error, action } = useIntegrationOperation();
const tokenUrl = computed(() => `https://${props.instance}/-/user_settings/personal_access_tokens`);
const commands = useCommandScope(`gitlab-connection:${projectId}`, () => ({
  surface: "gitlab-integration",
  projectId,
  repository: `${props.instance}/${props.path}`,
}));
async function connect() {
  const value = token.value.trim();
  if (!value) throw new Error("Укажите токен GitLab");
  const data = await fetchIntegrations();
  const integration = data.integrations.find((item) => item.id === "gitlab");
  if (!integration) throw new Error("Интеграция GitLab не найдена");
  if (!integration.enabled)
    await integrationRequest("/gitlab", "PUT", {
      ...integration.settings,
      enabled: true,
    });
  await integrationRequest("/gitlab/auth", "POST", { token: value });
  token.value = "";
  emit("connected");
}
commands.scope.registerCommand({
  id: "ide.gitlab.integration.connect",
  title: "Подключить GitLab",
  description:
    "Подключает GitLab по Personal Access Token (scope read_api и read_repository), введённому в форме, и открывает проект.",
  enabled: () => !busy.value && !!token.value.trim(),
  run: () => action(connect),
});
// Что штатный агент видит на вкладке подключения GitLab: проект и состояние формы без токена.
useTabReadout(() => ({
  note: "Подключение к GitLab",
  text: readoutLines(
    `Проект: ${props.instance}/${props.path}`,
    busy.value ? "Состояние: подключение…" : "Состояние: не подключено",
    token.value.trim() ? "Токен: введён" : "Токен: не введён",
    error.value ? `Ошибка: ${error.value}` : "",
  ),
}));
</script>

<template>
  <section class="connection">
    <UiHeading>Подключить GitLab</UiHeading>
    <p>Установите Personal Access Token, чтобы открыть {{ instance }}/{{ path }}.</p>
    <UiHint size="xs" wrap class="scopes">
      Нужны права <code>read_api</code> и <code>read_repository</code>. Токен хранится только в
      настройках Projector на этой машине.
    </UiHint>
    <UiStack as="form" @submit.prevent="commands.run('ide.gitlab.integration.connect')">
      <UiLabel :for="tokenId" size="sm">Токен GitLab</UiLabel>
      <UiControl
        :id="tokenId"
        v-model="token"
        type="password"
        autocomplete="off"
        placeholder="glpat-…"
        :disabled="busy"
        required
      />
      <UiButton
        type="submit"
        data-command="ide.gitlab.integration.connect"
        :disabled="busy || !token.trim()"
        >{{ busy ? "Подключаю…" : "Подключить GitLab" }}</UiButton
      >
    </UiStack>
    <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
    <a :href="tokenUrl" target="_blank" rel="noopener noreferrer">Создать токен в GitLab ↗</a>
  </section>
</template>

<style scoped>
.connection {
  max-width: 460px;
  padding: var(--sp-5);
}
p,
a {
  font-size: var(--fs-sm);
}
p,
a {
  color: var(--muted);
}
.scopes {
  margin-top: var(--sp-2);
}
.scopes code {
  font-family: var(--mono);
}
form {
  margin: var(--sp-4) 0;
}
input {
  min-width: 0;
}
form :deep(button) {
  justify-self: start;
}
a {
  text-decoration: underline;
}
</style>
