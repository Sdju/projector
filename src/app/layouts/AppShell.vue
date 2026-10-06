<script setup lang="ts">
import { useCommandScope, commandArgs } from "../../common/utilities/commands.ts";
import { computed, ref } from "vue";
import { githubProjectRoute } from "../../../core/modules/github/index.ts";
import { useRoute, useRouter } from "vue-router";
import {
  useProjects,
  projectRoute,
  projectIconUrl,
  type ProjectLocation,
} from "../../modules/project/index.ts";
import { PathBar, MobileProjectPicker } from "../../modules/catalog/index.ts";
import { isFileDrag, pathsFromDataTransfer } from "../../modules/path-drop/index.ts";

defineProps<{ currentProject?: ProjectLocation }>();
const { projects, openPath } = useProjects();
const route = useRoute();
const router = useRouter();
const running = computed(
  () => projects.value.filter((item) => item.runtime?.status === "running").length,
);

const commands = useCommandScope("project:path", () => ({ surface: "project-path" }));
commands.scope.registerCommand({
  id: "ide.project.path.open",
  title: "Открыть проект по пути",
  description: "Открывает локальную папку либо gh:/owner/repository в readonly без клонирования.",
  arguments: { path: "string: абсолютный путь или gh:/owner/repository" },
  run: async (value) => {
    const { path } = commandArgs(value);
    if (typeof path !== "string") throw new Error("Укажите path");
    await router.push(projectRoute(path));
  },
});
commands.scope.registerCommand({
  id: "ide.github.repository.open",
  title: "Открыть репозиторий GitHub",
  description:
    "Открывает репозиторий GitHub в readonly без клонирования; публичный репозиторий не требует входа.",
  arguments: { repository: "string: owner/repository или ссылка GitHub" },
  run: async (value) => {
    const { repository } = commandArgs(value);
    if (typeof repository !== "string") throw new Error("Укажите repository");
    await router.push(githubProjectRoute(repository));
  },
});
commands.scope.registerCommand({
  id: "ide.project.paths.open",
  title: "Открыть папки как проекты",
  description:
    "Создаёт проекты для локальных папок, которых нет в каталоге, и открывает первую из них.",
  arguments: { paths: "string[]: абсолютные пути папок" },
  run: async (value) => {
    const { paths } = commandArgs(value);
    if (!Array.isArray(paths) || !paths.length || paths.some((path) => typeof path !== "string"))
      throw new Error("Укажите paths");
    const opened = [];
    for (const path of paths as string[]) opened.push((await openPath(path)).project);
    await router.push(projectRoute(opened[0].path));
  },
});
// Inside a workspace the terminal and file tree own dropped files; elsewhere a folder becomes a project.
const dropsProjects = computed(() => route.name === "launcher");
const dragging = ref(false);
const dropError = ref("");
let dragDepth = 0;
function dragEnter(event: DragEvent) {
  if (!dropsProjects.value || !isFileDrag(event.dataTransfer)) return;
  dragDepth++;
  dragging.value = true;
}
function dragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragging.value = false;
}
async function drop(event: DragEvent) {
  dragging.value = false;
  dragDepth = 0;
  if (!dropsProjects.value || !isFileDrag(event.dataTransfer)) return;
  const paths = pathsFromDataTransfer(event.dataTransfer);
  dropError.value = "";
  if (!paths.length) {
    dropError.value = "Не удалось прочитать путь. Перетащите папку из файлового менеджера.";
    return;
  }
  try {
    await commands.scope.executeCommand<void>("ide.project.paths.open", { paths });
  } catch (err) {
    dropError.value = err instanceof Error ? err.message : "Не удалось открыть папку";
  }
}
const navigatePath = (path: string) =>
  commands.scope.executeCommand<void>("ide.project.path.open", { path });
</script>

<template>
  <div
    class="shell"
    :class="{
      workspace: route.name === 'project' || route.name === 'github-project',
      settings: route.name === 'settings',
    }"
    @dragenter="dragEnter"
    @dragover.prevent
    @dragleave="dragLeave"
    @drop.prevent="drop"
  >
    <div v-if="dragging" class="drop-hint">Бросьте папку — откроем проект</div>
    <header class="top" :class="{ 'has-project': currentProject }">
      <MobileProjectPicker
        v-if="currentProject"
        :key="currentProject.id"
        class="mobile-picker"
        :project="currentProject"
      />
      <router-link
        class="brand"
        :class="{ 'project-brand': currentProject }"
        to="/"
        :title="currentProject ? `${currentProject.name} — открыть поиск` : 'Открыть поиск'"
      >
        <img
          v-if="currentProject"
          :src="projectIconUrl(currentProject)"
          alt=""
          width="22"
          height="22"
        />
        <span>{{ currentProject?.name ?? "projector" }}</span>
      </router-link>
      <PathBar
        v-if="currentProject"
        :key="currentProject.id"
        class="header-path"
        :path="currentProject.path"
        :navigate="navigatePath"
      />
      <nav class="nav">
        <router-link v-if="!currentProject" to="/settings">настройки</router-link>
        <span
          class="count"
          :class="{ active: running }"
          :title="`Запущено проектов: ${running}`"
          :aria-label="`Запущено проектов: ${running}`"
          role="status"
          ><span class="count-dot" aria-hidden="true" />{{ running }}</span
        >
      </nav>
    </header>
    <p v-if="dropError" class="drop-error" role="alert">{{ dropError }}</p>
    <main>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.drop-hint {
  position: fixed;
  inset: 0;
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  pointer-events: none;
  border: 1px dashed var(--focus);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  color: var(--text);
}
.drop-error {
  margin: 0 0 var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
}
.mobile-picker {
  display: none;
}

.shell {
  --page-width: 760px;
  --brand-track: 0.16em;
  width: min(var(--page-width), calc(100% - var(--sp-4) * 2));
  margin: 0 auto;
  padding: var(--sp-4) 0 56px;
  min-height: 100%;
  position: relative;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
  gap: var(--sp-4);
}

.header-path {
  flex: 1;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
  font-size: var(--fs-xs);
  letter-spacing: var(--brand-track);
  text-transform: lowercase;
  color: var(--muted);
}

.brand.project-brand {
  flex-shrink: 1;
  min-width: 0;
  max-width: min(30vw, 320px);
  font-size: var(--fs-sm);
  letter-spacing: 0;
  text-transform: none;
  color: var(--text);
}

.brand span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand img {
  flex-shrink: 0;
  object-fit: contain;
  border-radius: var(--r-sm);
}

.nav {
  flex-shrink: 0;
  display: flex;
  gap: var(--sp-3);
  align-items: center;
}

.nav a,
.nav button,
.count {
  color: var(--muted);
  font-size: var(--fs-xs);
}

.nav a:hover,
.nav button:hover {
  color: var(--text);
}

.nav a.router-link-active {
  color: var(--text);
}

.count {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

.count-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--faint);
}

.count.active .count-dot {
  background: var(--run);
}

/* Рабочая область: один внешний отступ — зазор между островами, фон общий */
.shell.workspace {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: var(--island-gap);
  height: 100dvh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}
.workspace .top {
  margin-bottom: var(--island-gap);
  padding-inline: var(--sp-2);
}
.workspace main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.workspace main :deep(.project-page) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.shell.settings {
  --page-width: 1100px;
  padding-bottom: var(--sp-4);
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .shell,
  .shell.workspace {
    width: auto;
    margin-inline: max(var(--sp-2), env(safe-area-inset-left))
      max(var(--sp-2), env(safe-area-inset-right));
    padding-top: max(var(--sp-2), env(safe-area-inset-top));
    padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom));
  }
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
  }
  .brand,
  .brand.project-brand {
    max-width: none;
    min-width: 0;
    min-height: 44px;
    --brand-track: 0.06em;
  }
  .nav {
    grid-column: 2;
    grid-row: 1;
    gap: var(--sp-3);
  }
  .nav a,
  .nav button {
    display: flex;
    align-items: center;
    min-height: 44px;
  }
  .top.has-project {
    display: flex;
    margin-bottom: 0;
  }
  .has-project .brand,
  .has-project .header-path,
  .has-project .nav {
    display: none;
  }
  .mobile-picker {
    display: block;
  }
  .shell.workspace {
    margin-inline: 0;
    padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: none;
  }
  .workspace .top {
    padding-inline: 0;
    margin-bottom: 0;
  }
  .workspace main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .workspace main :deep(.project-page) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .header-path {
    grid-column: 1 / -1;
    height: 44px;
  }
}
</style>
