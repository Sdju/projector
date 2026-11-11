<script setup lang="ts">
import UiMessage from "../../common/ui/UiMessage.vue";
import UiButton from "../../common/ui/UiButton.vue";
import { useRoute, useRouter } from "vue-router";
import type { GitlabRepository } from "@ai-projector/core/modules/gitlab/index.ts";
import {
  ProjectWorkspace,
  IssueView,
  PullRequestView,
  PipelineView,
  JobView,
  ReleaseView,
  type TabViews,
} from "../workspace/index.ts";
import { settingsTabViews } from "../app-settings/index.ts";
import { useRemoteWorkspace } from "../integration-api/index.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { formatProjectRef, projectRoute } from "../project/index.ts";
import IconGitlab from "~icons/simple-icons/gitlab";
import { GitlabRequestError, readRepository } from "./client.ts";
import { ciTabParams } from "../workspace-api/index.ts";
import { createGitlabConnectionProfile, createGitlabWorkspaceProfile } from "./source.ts";
import GitlabClone from "./GitlabClone.vue";
import GitlabConnection from "./ui/GitlabConnection.vue";
import GitlabRepositoryInfo from "./ui/GitlabRepositoryInfo.vue";

const props = defineProps<{ instance: string; path: string }>();
const route = useRoute();
const router = useRouter();
const navigate = (path: string) => router.push(projectRoute(path)).then(() => undefined);
const repository = `${props.instance}/${props.path}`;
const projectId = formatProjectRef({ kind: "gitlab", instance: props.instance, path: props.path });
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
} = useRemoteWorkspace<GitlabRepository>({
  projectId,
  read: (signal) => readRepository(repository, gitRef(), signal),
  createProfile: (data, onMetadata) =>
    createGitlabWorkspaceProfile(
      repository,
      props.instance,
      props.path,
      data,
      gitRef(),
      onMetadata,
    ),
  createConnectionProfile: () => createGitlabConnectionProfile(props.instance, props.path),
  isAuthError: (err) =>
    err instanceof GitlabRequestError && (err.status === 401 || err.status === 403),
  errorFallback: "Не удалось открыть проект GitLab",
  readmeError: "Не удалось прочитать README",
  connectionTab: "gitlab-integration",
  initialPath: () => (typeof route.query.path === "string" ? route.query.path : ""),
});
const commands = useCommandScope(`gitlab:${projectId}`, () => ({
  surface: "gitlab",
  projectId,
  repository,
  readonly: true,
  commit: metadata.value?.commit || null,
}));
commands.scope.registerCommand({
  id: "ide.gitlab.repository.refresh",
  title: "Обновить проект GitLab",
  description: "Перечитывает GitLab и обновляет общий workspace без клонирования.",
  enabled: () => !!workspace.value,
  run: () => (needsConnection.value ? loadRepository() : workspace.value?.refresh()),
});
commands.scope.registerCommand({
  id: "ide.gitlab.repository.info",
  title: "Информация о проекте GitLab",
  description: "Открывает вкладку с описанием, статистикой и метаданными проекта GitLab.",
  enabled: () => !!metadata.value && !!workspace.value,
  run: () => workspace.value?.openTab("repository"),
});
commands.scope.registerCommand({
  id: "ide.gitlab.integration.open",
  title: "Настроить подключение GitLab",
  description: "Открывает вкладку интеграции GitLab для установки токена.",
  enabled: () => !!workspace.value,
  run: () => workspace.value?.openTab("gitlab-integration"),
});
const tabViews: TabViews = {
  ...settingsTabViews,
  "gitlab-integration": {
    component: GitlabConnection,
    ownKeys: true,
    keepAlive: true,
    props: () => ({
      instance: props.instance,
      path: props.path,
      onConnected: loadRepository,
    }),
  },
  repository: {
    component: GitlabRepositoryInfo,
    keepAlive: true,
    props: () => ({ repository: metadata.value }),
  },
  issue: {
    component: IssueView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      number: tab.params?.number,
      host: "GitLab",
      onOpen: host.openFile,
    }),
  },
  pull: {
    component: PullRequestView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      number: tab.params?.number,
      host: "GitLab",
      short: "MR",
      noun: "merge request",
      onOpen: host.openFile,
      onOpenSection: host.openSection,
      onOpenPullFile: host.openPullFile,
      onOpenJob: (job: { id: number; title: string }) =>
        host.openTab("job", ciTabParams(job), { preview: false }),
      onOpenPipeline: (pipeline: { id: number; title?: string }) =>
        host.openTab("pipeline", ciTabParams(pipeline), { preview: false }),
    }),
  },
  pipeline: {
    component: PipelineView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      id: tab.params?.id,
      number: tab.params?.number,
      host: "GitLab",
      onOpenJob: (job: { id: number; title: string }) =>
        host.openTab("job", ciTabParams(job), { preview: false }),
      onOpenFile: (file: { path: string; line?: number }) => host.openFile(file.path, file.line),
    }),
  },
  job: {
    component: JobView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      id: tab.params?.id,
      number: tab.params?.number,
      host: "GitLab",
      onOpenFile: (file: { path: string; line?: number }) => host.openFile(file.path, file.line),
    }),
  },
  release: {
    component: ReleaseView,
    keepAlive: true,
    props: (tab, host) => ({
      projectId: host.projectId,
      tag: typeof tab.params?.tag === "string" ? tab.params.tag : "",
      host: "GitLab",
    }),
  },
};
</script>

<template>
  <GitlabClone :repository="repository" :path="props.path" :navigate="navigate" />
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
        :title="needsConnection ? 'Подключить GitLab' : 'Информация о проекте'"
        :aria-label="needsConnection ? 'Подключить GitLab' : 'Информация о проекте'"
        :data-command="
          needsConnection ? 'ide.gitlab.integration.open' : 'ide.gitlab.repository.info'
        "
        @click="
          commands.run(
            needsConnection ? 'ide.gitlab.integration.open' : 'ide.gitlab.repository.info',
          )
        "
      >
        <IconGitlab aria-hidden="true" />
      </UiButton>
    </template>
    <template #terminal-status
      ><span v-if="error" role="alert">{{ error }}</span
      ><UiMessage
        as="span"
        tone="muted"
        size="xs"
        v-if="metadata"
        class="gitlab-status"
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
    {{ error || "открываю проект…" }}
  </UiMessage>
</template>
