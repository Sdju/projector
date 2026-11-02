<script setup lang="ts">
import UiBadge from "../../../common/ui/UiBadge.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiHeading from "../../../common/ui/UiHeading.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchIntegrations } from "../../../modules/integration-api/index.ts";
import type { Integration } from "../../../modules/integration-api/index.ts";
import { GitlabWorkspace } from "../../../modules/gitlab-workspace/index.ts";
import {
  GITLAB_DEFAULT_INSTANCE,
  gitlabProjectFromParams,
  normalizeGitlabInstance,
  normalizeGitlabProjectPath,
} from "../../../modules/project/index.ts";

const route = useRoute();
const router = useRouter();

const raw = computed(() => gitlabProjectFromParams(route.params.gitlabPath));
const parsed = computed(() => {
  try {
    const instance = normalizeGitlabInstance(raw.value.instance);
    return {
      instance,
      path: normalizeGitlabProjectPath(raw.value.path, instance),
      error: "",
    };
  } catch (err) {
    return {
      instance: raw.value.instance,
      path: raw.value.path,
      error: err instanceof Error ? err.message : "Некорректная ссылка GitLab",
    };
  }
});
const projectReference = computed(() => `gl:/${parsed.value.instance}/${parsed.value.path}`);

const integration = ref<Integration | null>(null);
const loading = ref(true);
const loadError = ref("");

function settingsAuthority(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "";
    return url.host.toLowerCase();
  } catch {
    try {
      return normalizeGitlabInstance(value);
    } catch {
      return "";
    }
  }
}

const configuredInstance = computed(() => settingsAuthority(integration.value?.settings.url));
const allowed = computed(
  () =>
    !parsed.value.error &&
    (parsed.value.instance === GITLAB_DEFAULT_INSTANCE ||
      (!!configuredInstance.value && parsed.value.instance === configuredInstance.value)),
);
// gitlab.com works anonymously, so a failed integration read must not hide its projects.
const workspaceReady = computed(
  () =>
    !parsed.value.error &&
    (parsed.value.instance === GITLAB_DEFAULT_INSTANCE ||
      (!loading.value && !loadError.value && allowed.value)),
);
const workspaceKey = computed(() => `${parsed.value.instance}/${parsed.value.path}`);

const status = computed(() => {
  if (loading.value)
    return {
      tone: "neutral" as const,
      label: "проверка",
      text: "Проверяем настройки интеграции GitLab…",
    };
  if (loadError.value) return { tone: "danger" as const, label: "ошибка", text: loadError.value };
  if (!integration.value)
    return {
      tone: "warning" as const,
      label: "не настроен",
      text: "GitLab не настроен. Публичные проекты gitlab.com доступны без входа.",
    };
  if (!integration.value.enabled)
    return {
      tone: "warning" as const,
      label: "отключён",
      text: "Интеграция GitLab отключена в настройках.",
    };
  if (integration.value.connected)
    return {
      tone: "info" as const,
      label: "подключено",
      text: integration.value.account
        ? `Вход выполнен как ${integration.value.account}.`
        : "Токен GitLab сохранён.",
    };
  return {
    tone: "neutral" as const,
    label: "без входа",
    text: "Публичные проекты gitlab.com доступны без входа; для приватных проектов подключите GitLab.",
  };
});

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await fetchIntegrations();
    integration.value = data.integrations.find((item) => item.id === "gitlab") ?? null;
  } catch (err) {
    integration.value = null;
    loadError.value = err instanceof Error ? err.message : "Не удалось прочитать интеграции";
  } finally {
    loading.value = false;
  }
}

function openSettings() {
  void router.push({ path: "/settings", query: { section: "gitlab" } });
}

watch(() => route.params.gitlabPath, load, { immediate: true });
</script>

<template>
  <section v-if="workspaceReady" class="project-page">
    <GitlabWorkspace :key="workspaceKey" :instance="parsed.instance" :path="parsed.path" />
  </section>
  <section v-else class="project-page gitlab-page">
    <UiCard class="gitlab-card">
      <UiStack :gap="3" align="start">
        <UiStack :gap="1" align="start">
          <UiHeading as="h1" :space-after="0">Проект GitLab</UiHeading>
          <code class="reference">{{ projectReference }}</code>
        </UiStack>

        <UiMessage v-if="parsed.error" tone="danger" variant="padded" flush role="alert">
          {{ parsed.error }}
        </UiMessage>

        <template v-else>
          <div class="status">
            <UiBadge :tone="status.tone">{{ status.label }}</UiBadge>
            <span class="status-text">{{ status.text }}</span>
          </div>

          <UiMessage v-if="!allowed" tone="danger" variant="padded" flush role="alert">
            Инстанс {{ parsed.instance }} не разрешён. Укажите его адрес в настройках GitLab или
            откройте проект на {{ GITLAB_DEFAULT_INSTANCE }}.
          </UiMessage>
        </template>

        <UiButton size="sm" @click="openSettings">Настроить GitLab</UiButton>
      </UiStack>
    </UiCard>
  </section>
</template>

<style scoped>
.gitlab-page {
  align-items: center;
  padding: var(--sp-4);
}
.gitlab-card {
  width: min(100%, 720px);
}
.reference {
  color: var(--muted);
  font: var(--fs-xs) var(--mono);
  overflow-wrap: anywhere;
}
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.status-text {
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
