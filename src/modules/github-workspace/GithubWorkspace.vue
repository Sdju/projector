<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { GithubRepository } from "../../../core/modules/github/index.ts";
import { ProjectWorkspace, type TabViews } from "../workspace/index.ts";
import { settingsTabViews } from "../app-settings/index.ts";
import { registerWorkspaceProfile, workspaceRequest } from "../workspace-api/index.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import { formatProjectRef } from "../project/index.ts";
import { GithubConnection } from "../github/index.ts";
import IconGithub from "~icons/simple-icons/github";
import { GithubRequestError, readRepository } from "./client.ts";
import { createGithubConnectionProfile, createGithubWorkspaceProfile } from "./source.ts";
import GithubRepositoryInfo from "./ui/GithubRepositoryInfo.vue";
const props = defineProps<{ repository: string }>();
const route = useRoute();
const metadata = ref<GithubRepository>();
const error = ref("");
const needsConnection = ref(false);
const profileReady = ref(false);
const workspaceVersion = ref(0);
const workspace = ref<InstanceType<typeof ProjectWorkspace>>();
const projectId = formatProjectRef({ kind: "github", repository: props.repository });
const controller = new AbortController();
let disconnect: (() => void) | undefined;
let disposed = false;
let openedInitial = false;
const commands = useCommandScope(`github:${projectId}`, () => ({
  surface: "github",
  projectId,
  repository: props.repository,
  readonly: true,
  commit: metadata.value?.commit || null,
}));
commands.scope.registerCommand({
  id: "ide.github.repository.refresh",
  title: "Обновить репозиторий GitHub",
  description: "Перечитывает GitHub и обновляет общий workspace без клонирования.",
  enabled: () => !!workspace.value,
  run: () => needsConnection.value ? loadRepository() : workspace.value?.refresh(),
});
commands.scope.registerCommand({
  id: "ide.github.repository.info",
  title: "Информация о репозитории GitHub",
  description: "Открывает вкладку с описанием, статистикой и метаданными репозитория.",
  enabled: () => !!metadata.value && !!workspace.value,
  run: () => workspace.value?.openTab("repository"),
});
commands.scope.registerCommand({
  id: "ide.github.integration.open",
  title: "Настроить подключение GitHub",
  description: "Открывает вкладку интеграции GitHub для установки токена.",
  enabled: () => !!workspace.value,
  run: () => workspace.value?.openTab("github-integration"),
});
const tabViews: TabViews = {
  ...settingsTabViews,
  "github-integration": {
    component: GithubConnection,
    ownKeys: true,
    keepAlive: true,
    props: () => ({ repository: props.repository, onConnected: loadRepository }),
  },
  repository: {
    component: GithubRepositoryInfo,
    props: () => ({ repository: metadata.value }),
  },
};
async function loadRepository() {
  error.value = "";
  try {
    const ref = typeof route.query.ref === "string" ? route.query.ref : "";
    const data = await readRepository(props.repository, ref, controller.signal);
    if (disposed) return;
    const profile = createGithubWorkspaceProfile(props.repository, data, ref, (value) => {
      metadata.value = value;
    });
    disconnect?.();
    disconnect = registerWorkspaceProfile(projectId, profile);
    metadata.value = data;
    needsConnection.value = false;
    openedInitial = false;
    workspaceVersion.value++;
    profileReady.value = true;
  } catch (err) {
    if (disposed) return;
    if (err instanceof GithubRequestError && err.status === 401) {
      disconnect?.();
      disconnect = registerWorkspaceProfile(projectId, createGithubConnectionProfile(props.repository));
      metadata.value = undefined;
      needsConnection.value = true;
      openedInitial = false;
      workspaceVersion.value++;
      profileReady.value = true;
    } else
      error.value = err instanceof Error ? err.message : "Не удалось открыть репозиторий";
  }
}
onMounted(loadRepository);
async function openInitial() {
  if (!metadata.value || metadata.value.empty) return;
  const path = typeof route.query.path === "string" ? route.query.path : "";
  if (path) return workspace.value?.openFile(path);
  const root = await workspaceRequest<{ entries: Array<{ name: string }> }>(projectId, "tree");
  const readme = root.entries.find((entry) => /^readme\.(?:md|markdown)$/i.test(entry.name));
  if (!disposed && readme) await workspace.value?.openFile(readme.name);
}
function ready(instance: unknown) {
  workspace.value = instance as InstanceType<typeof ProjectWorkspace> | undefined;
  if (!workspace.value || openedInitial) return;
  openedInitial = true;
  if (needsConnection.value) {
    workspace.value.openTab("github-integration");
    return;
  }
  void openInitial().catch((err) => {
    error.value = err instanceof Error ? err.message : "Не удалось прочитать README";
  });
}
onBeforeUnmount(() => {
  disposed = true;
  controller.abort();
  disconnect?.();
});
</script>
<template>
  <ProjectWorkspace v-if="profileReady" :key="workspaceVersion" :ref="ready" :project-id="projectId" :tab-views="tabViews">
    <template #terminal-actions>
      <UiButton
        icon
        size="sm"
        :title="needsConnection ? 'Подключить GitHub' : 'Информация о репозитории'"
        :aria-label="needsConnection ? 'Подключить GitHub' : 'Информация о репозитории'"
        :data-command="needsConnection ? 'ide.github.integration.open' : 'ide.github.repository.info'"
        @click="commands.run(needsConnection ? 'ide.github.integration.open' : 'ide.github.repository.info')"
      >
        <IconGithub aria-hidden="true" />
      </UiButton>
    </template>
    <template #terminal-status
      ><span v-if="error" role="alert">{{ error }}</span
      ><span v-if="metadata" class="github-status" :title="metadata.commit"
        >{{ metadata.branch }} · {{ metadata.commit.slice(0, 7) }} · только чтение</span
      ></template
    >
  </ProjectWorkspace>
  <p v-else class="msg" :role="error ? 'alert' : 'status'">
    {{ error || "открываю репозиторий…" }}
  </p>
</template>
<style scoped>
.github-status,
.msg {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.msg {
  padding: var(--sp-3);
}
.msg[role="alert"] {
  color: var(--err);
}
</style>
