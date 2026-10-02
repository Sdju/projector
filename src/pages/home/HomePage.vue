<script setup lang="ts">
import { useRouter } from "vue-router";
import GithubImport from "../../modules/integrations/GithubImport.vue";
import UiButton from "../../common/ui/UiButton.vue";
import {
  AddComposer,
  ProjectCard,
  useProjects,
} from "../../modules/catalog/index.ts";
import { RunControls } from "../../modules/runner/index.ts";

const { projects, loading, error } = useProjects();
const router = useRouter();
</script>

<template>
  <section>
    <AddComposer />
    <GithubImport />

    <p v-if="error" class="msg">{{ error }}</p>

    <div v-if="!projects.length && !loading" class="empty">
      Выберите папку, вставьте путь или бросьте каталог проекта.
    </div>

    <ProjectCard v-for="project in projects" :key="project.id" :project="project">
      <RunControls :project="project" compact />
      <UiButton variant="chip" @click="router.push(`/projects/${project.id}`)">ещё</UiButton>
    </ProjectCard>
  </section>
</template>

<style scoped>
.empty,
.msg {
  color: var(--muted);
  margin: 0 0 16px;
}

.msg {
  color: var(--err);
}
</style>
