<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { useProjects } from "../../project/index.ts";
import type { Project } from "../../project/index.ts";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ restored: [project: Project]; removed: [] }>();

const catalog = useProjects();
const path = ref(props.project.path);
const create = ref(false);
const busy = ref(false);
const error = ref("");

async function guarded<T>(task: () => Promise<T>): Promise<T | undefined> {
  if (busy.value) throw new Error("Операция уже выполняется");
  busy.value = true;
  error.value = "";
  try {
    return await task();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось выполнить действие";
    throw err;
  } finally {
    busy.value = false;
  }
}
async function recreate() {
  const project = await guarded(() =>
    catalog.restoreDirectory(props.project.id, { mode: "create" }),
  );
  if (project) emit("restored", project);
}
async function relocate(target = path.value, createMissing = create.value) {
  const project = await guarded(() =>
    catalog.restoreDirectory(props.project.id, {
      mode: "relocate",
      path: target,
      create: createMissing,
    }),
  );
  if (project) emit("restored", project);
}
async function remove() {
  if (
    busy.value ||
    !window.confirm(`Убрать «${props.project.name}» из Projector? Файлы на диске не затрагиваются.`)
  )
    return;
  await guarded(() => catalog.remove(props.project.id));
  emit("removed");
}

const commands = useCommandScope("project:missing", () => ({
  surface: "project-missing",
  projectId: props.project.id,
  path: props.project.path,
}));
commands.scope.registerCommand({
  id: "ide.project.directory.create",
  title: "Создать папку проекта заново",
  description: "Создаёт отсутствующую папку проекта по сохранённому пути.",
  run: () => recreate(),
});
commands.scope.registerCommand({
  id: "ide.project.directory.relocate",
  title: "Указать новый путь проекта",
  description:
    "Привязывает проект к другой папке; create: true создаст её, если она не существует.",
  arguments: {
    path: "string: абсолютный путь или ~/…",
    create: "boolean (необязательно): создать папку, если её нет",
  },
  run: (value) => {
    const args = commandArgs(value);
    if (typeof args.path !== "string") throw new Error("Укажите path");
    return relocate(args.path, args.create === true);
  },
});
</script>

<template>
  <section class="project-missing" aria-label="Папка проекта не найдена">
    <h2>Папка проекта не найдена</h2>
    <p class="lead">
      Проект «{{ project.name }}» сохранён, но каталог <code>{{ project.path }}</code> больше не
      существует. Создайте его заново или укажите новый путь.
    </p>

    <div class="block">
      <UiButton variant="solid" :disabled="busy" @click="recreate">Создать папку заново</UiButton>
      <UiHint>Каталог будет создан пустым по прежнему пути.</UiHint>
    </div>

    <form class="block" @submit.prevent="relocate()">
      <label class="field"
        >Новый путь<input
          v-model="path"
          required
          spellcheck="false"
          autocomplete="off"
          placeholder="/путь/к/проекту или ~/code/проект"
      /></label>
      <label class="check"
        ><input v-model="create" type="checkbox" /> Создать папку, если её нет</label
      >
      <UiButton type="submit" :disabled="busy || !path.trim()">Указать путь</UiButton>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="block footer">
      <UiButton variant="danger" :disabled="busy" @click="remove">Убрать из Projector</UiButton>
      <router-link to="/">к поиску</router-link>
    </div>
  </section>
</template>

<style scoped>
.project-missing {
  display: grid;
  gap: var(--sp-4);
  max-width: 560px;
  padding: var(--sp-5, var(--sp-4));
}
h2 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
}
.lead {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-sm);
}
code {
  font-family: var(--mono);
  overflow-wrap: anywhere;
}
.block {
  display: grid;
  gap: var(--sp-2);
  justify-items: start;
}
.field {
  display: grid;
  gap: var(--sp-1);
  width: 100%;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.check {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
}
.error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
.footer {
  grid-auto-flow: column;
  justify-content: space-between;
  align-items: center;
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line);
}
</style>
