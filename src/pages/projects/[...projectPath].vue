<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ProjectSettings,
  useProjects,
  projectPathFromParams,
  projectRoute,
} from "../../modules/catalog/index.ts";
import { RunControls, useRunner } from "../../modules/runner/index.ts";
import { ProjectWorkspace } from "../../modules/workspace/index.ts";

const route = useRoute();
const router = useRouter();
const { projects, openPath } = useProjects();
const { error } = useRunner();

const settings = ref<InstanceType<typeof ProjectSettings>>();
const settingsDirty = ref(false);

const projectId = ref("");
const opening = ref(false);
const openError = ref("");
const project = computed(() => projects.value.find((item) => item.id === projectId.value));

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
    <ProjectWorkspace
      :key="`${project.id}:${project.path}`"
      :project-id="project.id"
      :project-settings-dirty="settingsDirty"
      :before-close-project-settings="() => settings?.canLeave() ?? true"
      :save-project-settings="() => settings?.save()"
    >
      <template #project>
        <ProjectSettings
          ref="settings"
          :project="project"
          @dirty="settingsDirty = $event"
          :after-remove="() => router.push('/projects')"
        />
      </template>
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
  padding: 10px 12px;
  color: var(--err);
  font-size: 12px;
}
</style>
