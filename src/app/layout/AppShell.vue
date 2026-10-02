<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isFileDrag, pathsFromDataTransfer } from "../../common/lib/drop-paths.ts";
import { useAddSession } from "../../modules/catalog/model/add-session.ts";
import { useProjects } from "../../modules/catalog/index.ts";

const { projects } = useProjects();
const add = useAddSession();
const route = useRoute();
const router = useRouter();
const running = computed(
  () => projects.value.filter((item) => item.runtime?.status === "running").length,
);

const dragging = ref(false);
let dragDepth = 0;

function onDragEnter(event: DragEvent): void {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  dragDepth += 1;
  dragging.value = true;
}

function onDragOver(event: DragEvent): void {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onDragLeave(event: DragEvent): void {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  dragDepth = 0;
  dragging.value = false;
  const paths = pathsFromDataTransfer(event.dataTransfer);
  if (route.path !== "/projects") await router.push("/projects");
  await add.fromPaths(paths);
}
</script>

<template>
  <div
    class="shell"
    :class="{ dragging }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <header class="top">
      <router-link class="brand" to="/">projector</router-link>
      <nav class="nav">
        <router-link to="/projects">проекты</router-link>
        <router-link to="/settings">настройки</router-link>
        <span class="count">{{ running }}</span>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <div v-if="dragging" class="veil">бросьте папку — добавим проект</div>
  </div>
</template>

<style scoped>
.shell {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto;
  padding: 18px 0 56px;
  min-height: 100%;
  position: relative;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.brand {
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: lowercase;
  color: var(--muted);
}

.nav {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.nav a,
.count {
  color: var(--faint);
  font-size: 12px;
}

.nav a.router-link-active {
  color: var(--muted);
}

.veil {
  position: fixed;
  inset: 12px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--focus);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  color: var(--text);
  font-size: 15px;
  pointer-events: none;
  z-index: 20;
}

.dragging main {
  opacity: 0.35;
}
</style>
