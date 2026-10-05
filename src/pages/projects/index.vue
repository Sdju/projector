<script setup lang="ts">
import UiEmpty from "../../common/ui/UiEmpty.vue";
import { useProjects } from "../../modules/project/index.ts";
import { ProjectCard } from "../../modules/catalog/index.ts";
import { RunControls } from "../../modules/runner/index.ts";

const { projects, loading, error } = useProjects();
</script>

<template>
  <section class="project-catalog">
    <p v-if="error" class="msg">{{ error }}</p>

    <UiEmpty v-if="!projects.length && !loading">
      Проект создаётся сам: введите путь в строке пути, найдите папку в палитре или бросьте
      каталог на окно.
    </UiEmpty>

    <ProjectCard v-for="project in projects" :key="project.id" :project="project">
      <RunControls :project="project" compact />
    </ProjectCard>
  </section>
</template>

<style scoped>
.project-catalog {
  min-height: 240px;
}

.msg {
  color: var(--err);
  margin: 0 0 var(--sp-4);
}
</style>
