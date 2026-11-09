<script setup lang="ts">
import UiMessage from "../../common/ui/UiMessage.vue";
import { useRoute, useRouter } from "vue-router";
import type { GithubRepository } from "@projector/core/modules/github/index.ts";
import {
  ProjectWorkspace,
  PipelineView,
  JobView,
  ReleaseView,
  type TabViews,
} from "../workspace/index.ts";
import { settingsTabViews } from "../app-settings/index.ts";
import { useRemoteWorkspace } from "../integration-api/index.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import { formatProjectRef, projectRoute } from "../project/index.ts";
import { GithubClone, GithubConnection } from "../github/index.ts";
import IconGithub from "~icons/simple-icons/github";
import { GithubRequestError, readRepository } from "./client.ts";
import { createGithubConnectionProfile, createGithubWorkspaceProfile } from "./source.ts";
import GithubRepositoryInfo from "./ui/GithubRepositoryInfo.vue";
const props = defineProps<{ repository: string }>();
const route = useRoute();
const router = useRouter();
const navigate = (path: string) => router.push(projectRoute(path)).then(() => undefined);
const projectId = formatProjectRef({ kind: "github", repository: props.repository });
const gitRef = () => (typeof route.query.ref === "string" ? route.query.ref : "");
const {
  metadata,
  error,
  needsConnection,
  profileReady,
  workspaceVersion,
  workspace,
  loadRepository,
  ready,
} = useRemoteWorkspace<GithubRepository>({
  projectId,
  read: (signal) => readRepository(props.repository, gitRef(), signal),
  createProfile: (data, onMetadata) =>
    createGithubWorkspaceProfile(props.repository, data, gitRef(), onMetadata),
  createConnectionProfile: () => createGithubConnectionProfile(props.repository),
  isAuthError: (err) => err instanceof GithubRequestError && err.status === 401,
  errorFallback: "Не удалось открыть репозиторий",
  readmeError: "Не удалось прочитать README",
  connectionTab: "github-integration",
  initialPath: () => (typeof route.query.path === "string" ? route.query.path : ""),
});
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
  run: () => (needsConnection.value ? loadRepository() : workspace.value?.refresh()),
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
    keepAlive: true,
    props: () => ({ repository: metadata.value }),
  },
  pipeline: {
    component: PipelineView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      id: tab.params?.id,
      host: "GitHub",
      onOpenJob: (job: { id: number; title: string }) =>
        host.openTab("job", job, { preview: false }),
    }),
  },
  job: {
    component: JobView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      id: tab.params?.id,
      host: "GitHub",
    }),
  },
  release: {
    component: ReleaseView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      tag: typeof tab.params?.tag === "string" ? tab.params.tag : "",
      host: "GitHub",
    }),
  },
};
</script>
<template>
  <GithubClone :repository="props.repository" :navigate="navigate" />
  <ProjectWorkspace
    v-if="profileReady"
    :key="workspaceVersion"
    :ref="ready"
    :project-id="projectId"
    :tab-views="tabViews"
  >
    <template #terminal-actions>
      <UiButton
        shape="icon"
        size="sm"
        :title="needsConnection ? 'Подключить GitHub' : 'Информация о репозитории'"
        :aria-label="needsConnection ? 'Подключить GitHub' : 'Информация о репозитории'"
        :data-command="
          needsConnection ? 'ide.github.integration.open' : 'ide.github.repository.info'
        "
        @click="
          commands.run(
            needsConnection ? 'ide.github.integration.open' : 'ide.github.repository.info',
          )
        "
      >
        <IconGithub aria-hidden="true" />
      </UiButton>
    </template>
    <template #terminal-status
      ><span v-if="error" role="alert">{{ error }}</span
      ><UiMessage
        as="span"
        tone="muted"
        size="xs"
        v-if="metadata"
        class="github-status"
        :title="metadata.commit"
        >{{ metadata.branch }} · {{ metadata.commit.slice(0, 7) }} · только чтение</UiMessage
      ></template
    >
  </ProjectWorkspace>
  <UiMessage
    size="xs"
    variant="padded"
    :tone="error ? 'danger' : 'muted'"
    v-else
    class="msg"
    :role="error ? 'alert' : 'status'"
  >
    {{ error || "открываю репозиторий…" }}
  </UiMessage>
</template>
