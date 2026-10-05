<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useIdeCommands } from "../../ide/index.ts";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import {
  useProjects,
  projectRoute,
  parseProjectRef,
  isAbsoluteLocalPath,
  projectIconUrl,
  type ProjectLocation,
} from "../../project/index.ts";
import PathBar from "./PathBar.vue";
import IconChevron from "~icons/lucide/chevron-down";
import IconClose from "~icons/lucide/x";

const props = defineProps<{ project: ProjectLocation }>();
const router = useRouter();
const { api } = useIdeCommands();
const { projects } = useProjects();
const open = ref(false);
const choices = computed(() => [
  props.project,
  ...projects.value.filter((item) => item.id !== props.project.id),
]);
const commands = useCommandScope("mobile-project-picker", () => ({ surface: "workbench" }));
commands.scope.registerCommand({
  id: "ide.project.picker.toggle",
  title: "Открыть или закрыть выбор проекта",
  description: "Показывает мобильный выбор проекта, путь к папке и навигацию.",
  run: () => {
    open.value = !open.value;
  },
});
commands.scope.registerCommand({
  id: "ide.project.picker.navigate",
  title: "Открыть проект или страницу",
  description:
    "Открывает папку проекта либо поиск, список проектов или настройки из мобильной шапки.",
  arguments: {
    path: "Абсолютный путь к папке проекта или gh:/owner/repository",
    page: "search или settings",
  },
  run: async (value) => {
    const { path, page } = commandArgs(value);
    if (page === "settings" && path === undefined) {
      await api.executeCommand("ide.workbench.settings.open", undefined, {
        scope: `editor:${props.project.id}`,
      });
      open.value = false;
      return;
    }
    const pages: Record<string, string> = {
      search: "/",
      settings: "/settings",
    };
    const target =
      typeof path === "string" &&
        (isAbsoluteLocalPath(path) || parseProjectRef(path).kind === "github")
        ? projectRoute(path)
        : typeof page === "string"
          ? pages[page]
          : undefined;
    if (!target) throw new Error("Укажите путь проекта или страницу");
    await router.push(target);
    open.value = false;
  },
});
const navigate = (path: string) =>
  commands.scope.executeCommand<void>("ide.project.picker.navigate", { path });
</script>

<template>
  <div class="picker" @keydown.esc.stop="open && commands.run('ide.project.picker.toggle')">
    <button
      class="trigger"
      aria-label="Выбрать проект"
      :aria-expanded="open"
      @click="commands.run('ide.project.picker.toggle')"
    >
      <img :src="projectIconUrl(project)" alt="" width="22" height="22" />
      <span>{{ project.name }}</span
      ><IconChevron aria-hidden="true" />
    </button>
    <button
      v-if="open"
      class="backdrop"
      aria-label="Закрыть выбор проекта"
      @click="commands.run('ide.project.picker.toggle')"
    />
    <div v-if="open" class="sheet" @keydown.esc.stop="commands.run('ide.project.picker.toggle')">
      <div class="sheet-heading">
        <span>Выбор проекта</span>
        <button
          aria-label="Закрыть выбор проекта"
          @click="commands.run('ide.project.picker.toggle')"
        >
          <IconClose />
        </button>
      </div>
      <PathBar :path="project.path" :navigate="navigate" />
      <div class="projects" aria-label="Проекты">
        <button
          v-for="item in choices"
          :key="item.id"
          :class="{ selected: item.id === project.id }"
          @click="commands.run('ide.project.picker.navigate', { path: item.path })"
        >
          <img :src="projectIconUrl(item)" alt="" width="22" height="22" />
          <span
            ><strong>{{ item.name }}</strong
            ><small>{{ item.path }}</small></span
          >
        </button>
      </div>
      <nav>
        <button @click="commands.run('ide.project.picker.navigate', { page: 'search' })">
          Поиск
        </button>
        <button @click="commands.run('ide.project.picker.navigate', { page: 'settings' })">
          Настройки
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  min-width: 0;
  width: 100%;
}
.trigger {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  height: 44px;
  padding-inline: var(--sp-2);
  text-align: left;
}
.trigger span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
img {
  flex: none;
  object-fit: contain;
}
svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.backdrop {
  position: fixed;
  inset: calc(44px + env(safe-area-inset-top)) 0 0;
  z-index: var(--z-popover);
  background: var(--overlay);
}
.sheet {
  position: absolute;
  top: 100%;
  inset-inline: 0;
  z-index: calc(var(--z-popover) + 1);
  background: var(--bg-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-popover);
  padding: var(--sp-2);
}
.sheet-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.sheet-heading button {
  width: 44px;
  height: 44px;
}
.projects {
  max-height: 50dvh;
  overflow: auto;
  margin-block: var(--sp-2);
}
.projects button {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-3) var(--sp-2);
  text-align: left;
}
.projects button.selected,
.projects button:hover {
  background: var(--hover);
}
.projects span {
  min-width: 0;
}
strong,
small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
strong {
  font-size: var(--fs-sm);
  font-weight: 500;
}
small {
  font-size: var(--fs-2xs);
  color: var(--muted);
}
nav {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--line);
}
nav button {
  min-height: 44px;
  padding: var(--sp-2);
  font-size: var(--fs-xs);
}
</style>
