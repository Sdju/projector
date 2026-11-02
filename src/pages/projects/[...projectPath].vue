<script setup lang="ts">
import UiMessage from "../../common/ui/UiMessage.vue";
import { computed, h, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useProjects,
  projectPathFromParams,
  projectRoute,
  fetchProjectGithub,
  fetchProjectGitlab,
  ProjectOpening,
} from "../../modules/project/index.ts";
import type { Project } from "../../modules/project/index.ts";
import {
  ProjectMissing,
  ProjectSettings,
  useProjectCommands,
} from "../../modules/catalog/index.ts";
import { RunMenu, useRunner } from "../../modules/runner/index.ts";
import { DevcontainerTrust } from "../../modules/devcontainer/index.ts";
import {
  ProjectWorkspace,
  PipelineView,
  JobView,
  type TabViews,
} from "../../modules/workspace/index.ts";
import { registerWorkspaceProfile } from "../../modules/workspace-api/index.ts";
import {
  createGithubEnabledLocalProfile,
  GithubRepositoryInfoLoader,
} from "../../modules/github-workspace/index.ts";
import {
  createGitlabEnabledLocalProfile,
  GitlabRepositoryInfoLoader,
} from "../../modules/gitlab-workspace/index.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { useIdeCommands } from "../../modules/ide/index.ts";
import UiButton from "../../common/ui/UiButton.vue";
import IconGithub from "~icons/simple-icons/github";
import IconGitlab from "~icons/simple-icons/gitlab";
import IconProjectSettings from "~icons/lucide/sliders-horizontal";
import { projectInitPrompt, useAgent } from "../../modules/agent/index.ts";
import { settingsTabViews } from "../../modules/app-settings/index.ts";

const route = useRoute();
const router = useRouter();
const { projects, openPath } = useProjects();
const { error } = useRunner();
const { api } = useIdeCommands();

const settings = ref<InstanceType<typeof ProjectSettings>>();
const settingsDirty = ref(false);

// Set when the local project's `origin` points at a code host; adds issues and the info tab.
const githubRepository = ref<string | null>(null);
const gitlabRepository = ref<{ instance: string; path: string } | null>(null);

// The settings form keeps unsaved edits, so its tab stays mounted while it moves between docks.
const tabViews = computed<TabViews>(() => {
  const gitlab = gitlabRepository.value;
  const github = githubRepository.value;
  return {
    ...settingsTabViews,
    ...(gitlab
      ? {
          pipeline: {
            component: PipelineView,
            keepAlive: true,
            props: (tab, host) => ({
              projectId: host.projectId,
              id: tab.params?.id,
              host: "GitLab",
              onOpenJob: (job: { id: number; title: string }, pinned?: boolean) =>
                host.openTab("job", job, { preview: !pinned }),
            }),
          },
          job: {
            component: JobView,
            keepAlive: true,
            props: (tab, host) => ({
              projectId: host.projectId,
              id: tab.params?.id,
              host: "GitLab",
            }),
          },
        }
      : {}),
    repository: gitlab
      ? {
          component: GitlabRepositoryInfoLoader,
          keepAlive: true,
          props: () => ({ instance: gitlab.instance, path: gitlab.path }),
        }
      : {
          component: GithubRepositoryInfoLoader,
          keepAlive: true,
          props: () => ({ repository: github ?? "" }),
        },
    project: {
      keepAlive: true,
      ownKeys: true,
      component: () =>
        project.value &&
        h(ProjectSettings, {
          ref: settings,
          project: project.value,
          onDirty: (value: boolean) => (settingsDirty.value = value),
          afterRemove: () => router.push("/"),
        }),
    },
  };
});

const projectId = ref("");
const workspace = ref<InstanceType<typeof ProjectWorkspace>>();
// Registered even without a repository so the agent always sees a stable command; disabled until then.
const githubCommands = useCommandScope("project:github", () => ({
  surface: "project",
  projectId: projectId.value || null,
  repository: githubRepository.value ?? null,
}));
githubCommands.scope.registerCommand({
  id: "ide.github.repository.info",
  title: "Информация о репозитории GitHub",
  description:
    "Открывает вкладку с описанием, статистикой и метаданными репозитория GitHub проекта.",
  enabled: () => !!githubRepository.value && !!workspace.value,
  run: () => workspace.value?.openTab("repository"),
});
const gitlabCommands = useCommandScope("project:gitlab", () => ({
  surface: "project",
  projectId: projectId.value || null,
  instance: gitlabRepository.value?.instance ?? null,
  path: gitlabRepository.value?.path ?? null,
}));
gitlabCommands.scope.registerCommand({
  id: "ide.gitlab.repository.info",
  title: "Информация о проекте GitLab",
  description:
    "Открывает вкладку с описанием, статистикой и метаданными проекта GitLab локального проекта.",
  enabled: () => !!gitlabRepository.value && !!workspace.value,
  run: () => workspace.value?.openTab("repository"),
});
// A project created by this visit gets an agent tab with a suggested initialization request.
let initProjectId = "";
function suggestInit(instance: unknown) {
  workspace.value = instance as InstanceType<typeof ProjectWorkspace> | undefined;
  if (!workspace.value || !initProjectId || initProjectId !== projectId.value) return;
  const id = initProjectId;
  initProjectId = "";
  const agent = useAgent(id);
  if (!agent.draft.value.trim() && !agent.turns.value.length) agent.draft.value = projectInitPrompt;
  workspace.value.openTab("agent");
}
const missing = ref(false);
const opening = ref(false);
const openError = ref("");
const project = computed(() => projects.value.find((item) => item.id === projectId.value));
useProjectCommands(
  () => project.value,
  () => settingsDirty.value,
);

const reload = ref(0);
function restored(item: Project) {
  const canonical = projectRoute(item.path);
  if (route.path === canonical) reload.value++;
  else void router.replace(canonical);
}
watch(
  () => [projectPathFromParams(route.params.projectPath), reload.value] as const,
  async ([path], _, onCleanup) => {
    let active = true;
    let dispose: (() => void) | undefined;
    onCleanup(() => {
      active = false;
      dispose?.();
    });
    projectId.value = "";
    githubRepository.value = null;
    gitlabRepository.value = null;
    missing.value = false;
    openError.value = "";
    opening.value = true;
    try {
      const { project: item, missing: gone, created } = await openPath(path);
      // Detect `origin` before the workspace mounts so it opens with the matching local profile.
      const [github, gitlab] =
        gone || item.environment
          ? [null, null]
          : await Promise.all([
              fetchProjectGithub(item.id).then(
                (data) => data.repository,
                () => null,
              ),
              fetchProjectGitlab(item.id).then(
                (data) => data.repository,
                () => null,
              ),
            ]);
      if (active) {
        githubRepository.value = github;
        gitlabRepository.value = gitlab;
        dispose = gitlab
          ? registerWorkspaceProfile(
              item.id,
              createGitlabEnabledLocalProfile(item.id, gitlab.instance, gitlab.path),
            )
          : github
            ? registerWorkspaceProfile(item.id, createGithubEnabledLocalProfile(item.id, github))
            : undefined;
        projectId.value = item.id;
        initProjectId = created && !gone ? item.id : "";
        missing.value = gone;
        const canonical = projectRoute(item.path);
        if (route.path !== canonical) await router.replace(canonical);
      }
    } catch (err) {
      if (active)
        openError.value = err instanceof Error ? err.message : "Не удалось открыть проект";
    } finally {
      if (active) opening.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <section v-if="project && missing" class="project-page">
    <ProjectMissing
      :key="project.id"
      :project="project"
      @restored="restored"
      @removed="router.push('/')"
    />
  </section>
  <section v-else-if="project" class="project-page">
    <DevcontainerTrust :key="`${project.id}:${project.path}`" :project-id="project.id" />
    <ProjectWorkspace
      :ref="suggestInit"
      :key="`${project.id}:${project.path}`"
      :project-id="project.id"
      :project-settings-dirty="settingsDirty"
      :before-close-project-settings="() => settings?.canLeave() ?? true"
      :save-project-settings="() => settings?.save()"
      :tab-views="tabViews"
    >
      <template #terminal-actions>
        <RunMenu :project="project" />
        <UiButton
          shape="icon"
          size="sm"
          title="Настройки проекта"
          aria-label="Настройки проекта"
          data-command="ide.workbench.project.settings.open"
          @click="
            api.executeCommand('ide.workbench.project.settings.open', undefined, {
              scope: `editor:${project.id}`,
            })
          "
        >
          <IconProjectSettings aria-hidden="true" />
        </UiButton>
        <UiButton
          v-if="gitlabRepository"
          shape="icon"
          size="sm"
          title="Информация о проекте GitLab"
          aria-label="Информация о проекте GitLab"
          data-command="ide.gitlab.repository.info"
          @click="gitlabCommands.run('ide.gitlab.repository.info')"
        >
          <IconGitlab aria-hidden="true" />
        </UiButton>
        <UiButton
          v-else-if="githubRepository"
          shape="icon"
          size="sm"
          title="Информация о репозитории"
          aria-label="Информация о репозитории"
          data-command="ide.github.repository.info"
          @click="githubCommands.run('ide.github.repository.info')"
        >
          <IconGithub aria-hidden="true" />
        </UiButton>
      </template>
      <template #terminal-status>
        <UiMessage
          size="xs"
          variant="padded"
          tone="danger"
          flush
          v-if="error"
          class="msg"
          role="alert"
          >{{ error }}</UiMessage
        >
      </template>
    </ProjectWorkspace>
  </section>
  <section v-else-if="opening" class="project-page"><ProjectOpening /></section>
  <section v-else class="not-found project-page">
    <UiMessage
      size="xs"
      variant="padded"
      tone="danger"
      flush
      class="msg"
      :role="openError ? 'alert' : undefined"
    >
      {{ openError || "проект не найден" }}
    </UiMessage>
    <UiButton size="sm" @click="router.push('/')">К списку проектов</UiButton>
  </section>
</template>

<style scoped>
.not-found {
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-4);
}
</style>
