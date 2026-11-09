<script setup lang="ts">
import { computed } from "vue";
import { TokenConnectionForm } from "../../integration-api/index.ts";
import { fetchIntegrations, integrationRequest } from "../../integration-api/index.ts";
import { formatProjectRef } from "../../project/index.ts";

const props = defineProps<{ instance: string; path: string }>();
const emit = defineEmits<{ connected: [] }>();
const projectId = computed(() =>
  formatProjectRef({ kind: "gitlab", instance: props.instance, path: props.path }),
);
const tokenUrl = computed(() => `https://${props.instance}/-/user_settings/personal_access_tokens`);

async function connect(value: string) {
  const token = value.trim();
  if (!token) throw new Error("Укажите токен GitLab");
  const data = await fetchIntegrations();
  const integration = data.integrations.find((item) => item.id === "gitlab");
  if (!integration) throw new Error("Интеграция GitLab не найдена");
  if (!integration.enabled)
    await integrationRequest("/gitlab", "PUT", {
      ...integration.settings,
      enabled: true,
    });
  await integrationRequest("/gitlab/auth", "POST", { token });
}
</script>

<template>
  <TokenConnectionForm
    host="GitLab"
    subject-label="Проект"
    :subject="`${instance}/${path}`"
    :project-id="projectId"
    :scope-key="`gitlab-connection:${projectId}`"
    surface="gitlab-integration"
    placeholder="glpat-…"
    :token-url="tokenUrl"
    command-id="ide.gitlab.integration.connect"
    command-description="Подключает GitLab по Personal Access Token (scope read_api и read_repository), введённому в форме, и открывает проект."
    readout-note="Подключение к GitLab"
    intro="Установите Personal Access Token, чтобы открыть проект."
    :connect="connect"
    @connected="emit('connected')"
  >
    <template #hint>
      <p class="scopes">
        Нужны права <code>read_api</code> и <code>read_repository</code>. Токен хранится только в
        настройках Projector на этой машине.
      </p>
    </template>
  </TokenConnectionForm>
</template>

<style scoped>
.scopes {
  margin-top: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.scopes code {
  font-family: var(--mono);
}
</style>
