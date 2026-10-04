<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProjects, projectPathFromParams, projectRoute } from "../../modules/project/index.ts";
import { ProjectSettings, useProjectCommands } from "../../modules/catalog/index.ts";
import { RunControls, useRunner } from "../../modules/runner/index.ts";
import { DevcontainerTrust } from "../../modules/devcontainer/index.ts";
import { ProjectWorkspace, type TabViews } from "../../modules/workspace/index.ts";

const route = useRoute();
const router = useRouter();
const { projects, openPath } = useProjects();
const { error } = useRunner();

const settings = ref<InstanceType<typeof ProjectSettings>>();
const settingsDirty = ref(false);

// The settings form keeps unsaved edits, so its tab stays mounted while it moves between docks.
const tabViews: TabViews = {
  project: {
    keepAlive: true,
    scroll: true,
    ownKeys: true,
    component: () =>
      project.value &&
      h(ProjectSettings, {
        ref: settings,
        project: project.value,
        onDirty: (value: boolean) => (settingsDirty.value = value),
        afterRemove: () => router.push("/projects"),
      }),
  },
};

const projectId = ref("");
const opening = ref(false);
const openError = ref("");
const project = computed(() => projects.value.find((item) => item.id === projectId.value));
useProjectCommands(
  () => project.value,
  () => settingsDirty.value,
);

watch(
  () => projectPathFromParams(route.params.projectPath),
  async (path, _, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    projectId.value = "";
    openError.value = "";
    opening.value = true;
    try {
      const item = await openPath(path);
      if (active) {
        projectId.value = item.id;
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
  <section v-if="project" class="project-page">
    <DevcontainerTrust :key="`${project.id}:${project.path}`" :project-id="project.id" />
    <ProjectWorkspace
      :key="`${project.id}:${project.path}`"
      :project-id="project.id"
      :project-settings-dirty="settingsDirty"
      :before-close-project-settings="() => settings?.canLeave() ?? true"
      :save-project-settings="() => settings?.save()"
      :tab-views="tabViews"
    >
      <template #terminal-actions>
        <RunControls :project="project" toolbar />
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
    <router-link to="/projects">назад</router-link>
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
