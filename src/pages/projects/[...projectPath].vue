<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import UiButton from "../../common/ui/UiButton.vue";
import {
  ProjectForm,
  useProjects,
  projectPathFromParams,
  projectRoute,
  type Project,
  type ProjectDraft,
} from "../../modules/catalog/index.ts";
import { RunControls, useRunner } from "../../modules/runner/index.ts";
import { ProjectWorkspace } from "../../modules/workspace/index.ts";

const route = useRoute();
const router = useRouter();
const { projects, save, remove, inspect, openPath } = useProjects();
const { error } = useRunner();

const draft = ref<ProjectDraft | null>(null);
const formError = ref("");

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

function toDraft(item: Project): ProjectDraft {
  return {
    name: item.name,
    path: item.path,
    url: item.url,
    icon: item.icon ?? "",
    mode: item.mode,
    defaultCommandId: item.defaultCommandId,
    commands: item.commands.map((command) => ({ ...command })),
  };
}

watch(
  () => [project.value?.id, project.value?.path],
  () => {
    draft.value = project.value ? toDraft(project.value) : null;
    formError.value = "";
  },
  { immediate: true },
);

async function onInspect(path: string): Promise<void> {
  formError.value = "";
  try {
    const inspected = await inspect(path);
    draft.value = {
      ...inspected,
      name: draft.value?.name || inspected.name,
    };
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Не удалось прочитать проект";
  }
}

async function onSave(): Promise<void> {
  if (!project.value || !draft.value) return;
  formError.value = "";
  try {
    const saved = await save(project.value.id, draft.value);
    await router.replace(projectRoute(saved.path));
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Не удалось сохранить";
  }
}

async function onRemove(): Promise<void> {
  if (!project.value) return;
  if (!confirm("Удалить проект из списка?")) return;
  await remove(project.value.id);
  await router.push("/projects");
}
</script>

<template>
  <section v-if="project" class="project-page">
    <ProjectWorkspace :key="`${project.id}:${project.path}`" :project-id="project.id">
      <template #project>
        <p v-if="formError" class="msg" role="alert">{{ formError }}</p>
        <ProjectForm
          v-if="draft"
          v-model="draft"
          compact
          submit-label="сохранить"
          @inspect="onInspect"
          @submit="onSave"
        />
        <UiButton class="remove-project" variant="danger" @click="onRemove"
          >удалить проект</UiButton
        >
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
.remove-project {
  margin-top: 24px;
  font-size: 12px;
}
.msg {
  margin: 0;
  padding: 10px 12px;
  color: var(--err);
  font-size: 12px;
}
</style>
