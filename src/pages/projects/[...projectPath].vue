<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useProjects,
  projectPathFromParams,
  projectRoute,
  fetchProjectGithub,
} from "../../modules/project/index.ts";
import type { Project } from "../../modules/project/index.ts";
import {
  ProjectMissing,
  ProjectSettings,
  useProjectCommands,
} from "../../modules/catalog/index.ts";
import { RunMenu, useRunner } from "../../modules/runner/index.ts";
import { DevcontainerTrust } from "../../modules/devcontainer/index.ts";
import { ProjectWorkspace, type TabViews } from "../../modules/workspace/index.ts";
import { registerWorkspaceProfile } from "../../modules/workspace-api/index.ts";
import {
  createGithubEnabledLocalProfile,
  GithubRepositoryInfoLoader,
} from "../../modules/github-workspace/index.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import IconGithub from "~icons/simple-icons/github";
import { projectInitPrompt, useAgent } from "../../modules/agent/index.ts";
import { settingsTabViews } from "../../modules/app-settings/index.ts";

const route = useRoute();
const router = useRouter();
const { projects, openPath } = useProjects();
const { error } = useRunner();

const settings = ref<InstanceType<typeof ProjectSettings>>();
const settingsDirty = ref(false);

// Set when the local project's `origin` points at GitHub; adds issues and the info tab.
const repository = ref<string | null>(null);

// The settings form keeps unsaved edits, so its tab stays mounted while it moves between docks.
const tabViews: TabViews = {
  ...settingsTabViews,
  repository: {
    component: GithubRepositoryInfoLoader,
    props: () => ({ repository: repository.value ?? "" }),
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

const projectId = ref("");
const workspace = ref<InstanceType<typeof ProjectWorkspace>>();
// Registered even without a repository so the agent always sees a stable command; disabled until then.
const githubCommands = useCommandScope("project:github", () => ({
  surface: "project",
  projectId: projectId.value || null,
  repository: repository.value ?? null,
}));
githubCommands.scope.registerCommand({
  id: "ide.github.repository.info",
  title: "Информация о репозитории GitHub",
  description:
    "Открывает вкладку с описанием, статистикой и метаданными репозитория GitHub проекта.",
  enabled: () => !!repository.value && !!workspace.value,
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
  if (!agent.draft.value.trim() && !agent.turns.value.length)
    agent.draft.value = projectInitPrompt;
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
    repository.value = null;
    missing.value = false;
    openError.value = "";
    opening.value = true;
    try {
      const { project: item, missing: gone, created } = await openPath(path);
      // Detect `origin` before the workspace mounts so it opens with the local+GitHub profile.
      const github =
        gone || item.environment
          ? null
          : await fetchProjectGithub(item.id).then(
              (data) => data.repository,
              () => null,
            );
      if (active) {
        repository.value = github;
        dispose = github
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
          v-if="repository"
          icon
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
        <p v-if="error" class="msg" role="alert">{{ error }}</p>
      </template>
    </ProjectWorkspace>
  </section>
  <section v-else>
    <p class="msg" :role="openError ? 'alert' : undefined">
      {{ opening ? "открываю проект…" : openError || "проект не найден" }}
    </p>
    <router-link to="/">назад</router-link>
  </section>
</template>

<style scoped>
.msg {
  margin: 0;
  padding: var(--sp-3) var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
}
</style>
