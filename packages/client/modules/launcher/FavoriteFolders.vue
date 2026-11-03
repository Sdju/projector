<script setup lang="ts">
import UiHeading from "../../common/ui/UiHeading.vue";
import UiControl from "../../common/ui/UiControl.vue";
import { onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";

const folders = ref<string[]>([]);
const path = ref("");
const folder = ref("");
const name = ref("");
const error = ref("");
const status = ref("");
const busy = ref(false);

async function request<T>(url: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data as T;
}
async function action(task: () => Promise<string | void>) {
  busy.value = true;
  error.value = "";
  status.value = "";
  try {
    status.value = (await task()) ?? "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось выполнить";
  } finally {
    busy.value = false;
  }
}
async function load() {
  folders.value = (await request<{ folders: string[] }>("/api/launcher/folders")).folders;
  folder.value ||= folders.value[0] ?? "";
}
onMounted(() => action(load));

async function add(value: string) {
  const data = await request<{ folders: string[] }>("/api/launcher/folders", "POST", {
    path: value,
  });
  folders.value = data.folders;
  folder.value ||= data.folders[0] ?? "";
  path.value = "";
  return "Папка добавлена в избранные";
}
async function remove(value: string) {
  folders.value = (
    await request<{ folders: string[] }>("/api/launcher/folders", "DELETE", { path: value })
  ).folders;
  if (folder.value === value) folder.value = folders.value[0] ?? "";
  return "Папка убрана из избранных";
}
async function create(parent: string, projectName: string) {
  const data = await request<{ route: string }>("/api/launcher/folders/create", "POST", {
    folder: parent,
    name: projectName,
  });
  name.value = "";
  window.location.assign(data.route);
  return "Проект создан";
}

const commands = useCommandScope("favorite-folders", () => ({ surface: "favorite-folders" }));
commands.scope.registerCommand({
  id: "ide.folders.favorite.add",
  title: "Добавить избранную папку",
  description:
    "Делает папку избранной: её проекты идут в списке запуска первыми, в ней можно создавать новые проекты.",
  arguments: { path: "абсолютный путь или ~/…" },
  enabled: () => !busy.value,
  run: (value) => action(() => add(String(commandArgs(value).path ?? path.value))),
});
commands.scope.registerCommand({
  id: "ide.folders.favorite.remove",
  title: "Убрать избранную папку",
  description: "Убирает папку из избранных; сама папка и её проекты не удаляются.",
  arguments: { path: "путь избранной папки" },
  enabled: () => !busy.value && folders.value.length > 0,
  run: (value) => action(() => remove(String(commandArgs(value).path ?? ""))),
});
commands.scope.registerCommand({
  id: "ide.folders.project.create",
  title: "Создать проект в избранной папке",
  description:
    "Создаёт новую пустую папку проекта внутри избранной папки, добавляет её в каталог и открывает воркспейс. Существующая папка не перезаписывается.",
  arguments: { folder: "путь избранной папки", name: "имя нового проекта" },
  enabled: () => !busy.value && folders.value.length > 0,
  run: (value) => {
    const args = commandArgs(value);
    return action(() =>
      create(String(args.folder ?? folder.value), String(args.name ?? name.value)),
    );
  },
});
</script>

<template>
  <section class="favorite-folders">
    <UiHeading as="h2" size="sm">Избранные папки</UiHeading>
    <UiHint class="hint"
      >Проекты из этих папок идут в списке запуска первыми. В поиске наберите <code>new/имя</code>,
      чтобы создать проект в одной из них.</UiHint
    >
    <ul v-if="folders.length">
      <li v-for="item in folders" :key="item">
        <code>{{ item }}</code>
        <UiButton :disabled="busy" @click="action(() => remove(item))">Убрать</UiButton>
      </li>
    </ul>
    <form class="row" @submit.prevent="action(() => add(path))">
      <UiControl
        grow
        v-model="path"
        aria-label="Путь к папке"
        placeholder="~/projects"
        :disabled="busy"
      />
      <UiButton type="submit" :disabled="busy || !path.trim()">Добавить</UiButton>
    </form>
    <form v-if="folders.length" class="row" @submit.prevent="action(() => create(folder, name))">
      <UiControl
        grow
        as="select"
        v-model="folder"
        aria-label="Папка нового проекта"
        :disabled="busy"
      >
        <option v-for="item in folders" :key="item" :value="item">{{ item }}</option>
      </UiControl>
      <UiControl
        grow
        v-model="name"
        aria-label="Имя нового проекта"
        placeholder="новый-проект"
        :disabled="busy"
      />
      <UiButton type="submit" appearance="solid" :disabled="busy || !name.trim()"
        >Создать проект</UiButton
      >
    </form>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
  </section>
</template>

<style scoped>
.favorite-folders {
  margin-bottom: var(--sp-6);
}
ul {
  list-style: none;
  padding: 0;
  margin: var(--sp-3) 0;
  display: grid;
  gap: var(--sp-2);
}
li,
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin-top: var(--sp-2);
}
li code {
  flex: 1;
  overflow-wrap: anywhere;
}

.error {
  color: #c33;
}
</style>
