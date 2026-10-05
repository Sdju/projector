<script setup lang="ts">
import UiEmpty from "../../common/ui/UiEmpty.vue";
import { ref } from "vue";
import { isFileDrag, pathsFromDataTransfer } from "../../modules/path-drop/index.ts";
import { useAddSession } from "../../modules/project-composer/index.ts";
import { AddComposer } from "../../modules/project-composer/index.ts";
import { GithubImport } from "../../modules/integrations/index.ts";
import { useProjects } from "../../modules/project/index.ts";
import { ProjectCard } from "../../modules/catalog/index.ts";
import { RunControls } from "../../modules/runner/index.ts";

const { projects, loading, error } = useProjects();
const add = useAddSession();
const dragging = ref(false);
let dragDepth = 0;
function dragEnter(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  dragDepth++;
  dragging.value = true;
}
function dragOver(event: DragEvent) {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}
function dragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragging.value = false;
}
async function dropProjects(event: DragEvent) {
  dragging.value = false;
  dragDepth = 0;
  if (!isFileDrag(event.dataTransfer)) return;
  await add.fromPaths(pathsFromDataTransfer(event.dataTransfer));
}
</script>

<template>
  <section
    class="project-catalog"
    @dragenter="dragEnter"
    @dragover="dragOver"
    @dragleave="dragLeave"
    @drop.prevent="dropProjects"
  >
    <div v-if="dragging" class="drop-hint">Бросьте папку — добавим проект</div>
    <AddComposer />
    <GithubImport />

    <p v-if="error" class="msg">{{ error }}</p>

    <UiEmpty v-if="!projects.length && !loading">
      Выберите папку, вставьте путь или бросьте каталог проекта.
    </UiEmpty>

    <ProjectCard v-for="project in projects" :key="project.id" :project="project">
      <RunControls :project="project" compact />
    </ProjectCard>
  </section>
</template>

<style scoped>
.project-catalog {
  position: relative;
  min-height: 240px;
}
.drop-hint {
  position: absolute;
  inset: 0;
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  pointer-events: none;
  border: 1px dashed var(--focus);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  color: var(--text);
}

.msg {
  color: var(--muted);
  margin: 0 0 var(--sp-4);
}

.msg {
  color: var(--err);
}
</style>
