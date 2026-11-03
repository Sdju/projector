<script setup lang="ts">
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHeading from "../../../common/ui/UiHeading.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
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
commands.scope.registerCommand({
  id: "ide.project.missing.remove",
  title: "Убрать отсутствующий проект из Projector",
  description:
    "После подтверждения удаляет проект из каталога Projector. Файлы на диске не затрагиваются.",
  enabled: () => !busy.value,
  run: () => remove(),
});
</script>

<template>
  <UiStack as="section" :gap="4" class="project-missing" aria-label="Папка проекта не найдена">
    <UiHeading :space-after="0">Папка проекта не найдена</UiHeading>
    <p class="lead">
      Проект «{{ project.name }}» сохранён, но каталог <code>{{ project.path }}</code> больше не
      существует. Создайте его заново или укажите новый путь.
    </p>

    <UiStack :gap="2" align="start" class="block">
      <UiButton
        appearance="solid"
        :disabled="busy"
        @click="commands.run('ide.project.directory.create')"
        >Создать папку заново</UiButton
      >
      <UiHint>Каталог будет создан пустым по прежнему пути.</UiHint>
    </UiStack>

    <UiStack
      as="form"
      :gap="2"
      align="start"
      class="block"
      @submit.prevent="commands.run('ide.project.directory.relocate', { path, create })"
    >
      <UiField
        v-slot="{ control }"
        layout="plain"
        label="Новый путь"
        required
        :gap="1"
        class="field"
      >
        <UiControl
          v-bind="control"
          v-model="path"
          required
          spellcheck="false"
          autocomplete="off"
          placeholder="/путь/к/проекту или ~/code/проект"
      /></UiField>
      <UiInline as="label" justify="normal" class="check"
        ><UiControl v-model="create" type="checkbox" /> Создать папку, если её нет</UiInline
      >
      <UiButton type="submit" :disabled="busy || !path.trim()">Указать путь</UiButton>
    </UiStack>

    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>

    <UiInline justify="between" class="block footer">
      <UiButton tone="danger" :disabled="busy" @click="commands.run('ide.project.missing.remove')"
        >Убрать из Projector</UiButton
      >
      <router-link to="/">к поиску</router-link>
    </UiInline>
  </UiStack>
</template>

<style scoped>
.project-missing {
  max-width: 560px;
  padding: var(--sp-5, var(--sp-4));
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
.field {
  width: 100%;
  font-size: var(--fs-xs);
}
.check {
  font-size: var(--fs-xs);
}
.footer {
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line);
}
</style>
