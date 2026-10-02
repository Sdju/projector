<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import UiButton from "../../common/ui/UiButton.vue";
import { shortPath } from "../../common/lib/format.ts";
import {
  ProjectForm,
  useProjects,
  type Project,
  type ProjectDraft,
} from "../../modules/catalog/index.ts";
import { LogPane, RunControls, useRunner } from "../../modules/runner/index.ts";

const route = useRoute();
const router = useRouter();
const { projects, save, remove, inspect } = useProjects();
const { error, logsFor, hydrate } = useRunner();

const editing = ref(false);
const draft = ref<ProjectDraft | null>(null);
const formError = ref("");

const project = computed(() => projects.value.find((item) => item.id === String(route.params.id)));

const logs = computed(() => (project.value ? logsFor(project.value.id) : []));

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
  project,
  (item) => {
    if (item && !draft.value) draft.value = toDraft(item);
    if (item) void hydrate(item.id);
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
    await save(project.value.id, draft.value);
    editing.value = false;
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
  <section v-if="project">
    <router-link class="back" to="/projects">← все проекты</router-link>
    <div class="head">
      <div class="title">
        <img class="icon" :src="`/api/projects/${project.id}/icon`" alt="" />
        <div>
          <p class="path">{{ shortPath(project.path) }}</p>
          <h1>{{ project.name }}</h1>
        </div>
      </div>
      <div class="tools">
        <UiButton variant="ghost" @click="editing = !editing">{{
          editing ? "закрыть" : "править"
        }}</UiButton>
        <UiButton variant="danger" @click="onRemove">удалить</UiButton>
      </div>
    </div>

    <RunControls :project="project" />

    <p v-if="error" class="msg">{{ error }}</p>

    <div v-if="editing && draft" class="panel">
      <p v-if="formError" class="msg">{{ formError }}</p>
      <ProjectForm v-model="draft" submit-label="сохранить" @inspect="onInspect" @submit="onSave" />
    </div>

    <LogPane :lines="logs" />
  </section>
  <section v-else>
    <p class="msg">проект не найден</p>
    <router-link to="/projects">назад</router-link>
  </section>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: 18px;
  color: var(--muted);
  font-size: 13px;
}

.head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.title {
  display: flex;
  align-items: center;
  gap: 14px;
}

.icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--bg-2);
  flex: 0 0 auto;
}

.path {
  margin: 0 0 6px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}

h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.tools {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.panel {
  margin: 24px 0;
  padding: 18px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.msg {
  color: var(--err);
}
</style>
