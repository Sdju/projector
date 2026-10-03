<script setup lang="ts">
import UiHint from "../../../common/ui/UiHint.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import UiButton from "../../../common/ui/UiButton.vue";
import { inspectCommands } from "../api/client.ts";
import { useProjects } from "../model/store.ts";
import { missingCommands, projectDraft, settingsError } from "../model/project-settings.ts";
import type { Project, ProjectCommand } from "../model/types.ts";
import IconPlus from "~icons/lucide/plus";
import IconTrash from "~icons/lucide/trash-2";

const props = defineProps<{ project: Project; afterRemove: () => unknown }>();
const emit = defineEmits<{ dirty: [value: boolean] }>();
const catalog = useProjects();
const draft = ref(projectDraft(props.project));
const baseline = ref(JSON.stringify(draft.value));
const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value);
const busy = ref(false);
const discovering = ref(false);
const error = ref("");
const notice = ref("");
const discovered = ref<ProjectCommand[] | null>(null);
const candidates = computed(() => missingCommands(draft.value.commands, discovered.value ?? []));
const selected = ref<string[]>([]);
const validation = computed(() => settingsError(draft.value));

watch(
  dirty,
  (value) => {
    if (value) notice.value = "";
    emit("dirty", value);
  },
  { immediate: true },
);
watch(
  () => props.project,
  (project) => {
    if (!dirty.value && !busy.value && JSON.stringify(projectDraft(project)) !== baseline.value)
      reset(project);
  },
);

function reset(project = props.project) {
  draft.value = projectDraft(project);
  baseline.value = JSON.stringify(draft.value);
  error.value = "";
  notice.value = "";
  discovered.value = null;
  selected.value = [];
}
function canLeave() {
  return (
    !busy.value && (!dirty.value || window.confirm("Закрыть настройки без сохранения изменений?"))
  );
}
defineExpose({ canLeave, save });
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate((to, from) => to.path === from.path || canLeave());
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));

function addCommand() {
  draft.value.commands.push({ id: crypto.randomUUID(), name: "", cmd: "" });
}
function removeCommand(id: string) {
  if (draft.value.commands.length <= 1) return;
  draft.value.commands = draft.value.commands.filter((command) => command.id !== id);
  if (draft.value.defaultCommandId === id)
    draft.value.defaultCommandId = draft.value.commands[0]!.id;
}
async function discover() {
  discovering.value = true;
  error.value = "";
  try {
    discovered.value = (await inspectCommands(props.project.path)).commands;
    selected.value = candidates.value.map((command) => command.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось прочитать команды";
  } finally {
    discovering.value = false;
  }
}
function importCommands() {
  draft.value.commands.push(
    ...candidates.value.filter((command) => selected.value.includes(command.id)),
  );
  discovered.value = null;
  selected.value = [];
}
async function save() {
  if (busy.value || !dirty.value) return;
  error.value = validation.value;
  if (error.value) return;
  busy.value = true;
  try {
    const saved = await catalog.save(props.project.id, {
      ...draft.value,
      name: draft.value.name.trim(),
      url: draft.value.url.trim(),
      icon: draft.value.icon.trim(),
      commands: draft.value.commands.map((command) => ({
        ...command,
        name: command.name.trim(),
        cmd: command.cmd.trim(),
      })),
    });
    reset(saved);
    notice.value = "Настройки сохранены";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось сохранить настройки";
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (
    busy.value ||
    !window.confirm(
      `Убрать «${props.project.name}» из Projector? Терминалы и запущенные процессы проекта будут завершены. Файлы останутся на диске.`,
    )
  )
    return;
  busy.value = true;
  error.value = "";
  try {
    await catalog.remove(props.project.id);
    baseline.value = JSON.stringify(draft.value);
    await props.afterRemove();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось убрать проект";
  } finally {
    busy.value = false;
  }
}
function saveKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopPropagation();
    void save();
  }
}
</script>

<template>
  <form
    class="project-settings-form"
    aria-label="Настройки проекта"
    @submit.prevent="save"
    @keydown.capture="saveKey"
  >
    <fieldset :disabled="busy">
      <section class="settings-section">
        <h2>Проект</h2>
        <label class="field"
          >Название<input v-model="draft.name" required autocomplete="off"
        /></label>
        <div class="field">
          Папка проекта<code class="project-root">{{ project.path }}</code>
        </div>
        <details class="appearance">
          <summary>Иконка</summary>
          <label class="field"
            >Путь к иконке<input
              v-model="draft.icon"
              placeholder="Автоматически"
              spellcheck="false"
          /></label>
          <UiHint
            >Файл внутри проекта, например public/icon.svg. Пустое поле — автоматический
            выбор.</UiHint
          >
        </details>
      </section>

      <section class="settings-section">
        <div class="section-heading">
          <h2>Команды</h2>
          <UiButton :disabled="discovering" @click="discover">{{
            discovering ? "читаю…" : "из package.json"
          }}</UiButton>
        </div>
        <UiHint>Запускаются в терминале из папки проекта.</UiHint>
        <div v-if="discovered !== null" class="script-picker">
          <template v-if="candidates.length">
            <label v-for="command in candidates" :key="command.id" class="script-option">
              <input v-model="selected" type="checkbox" :value="command.id" />
              <span>{{ command.name }}</span
              ><code>{{ command.cmd }}</code>
            </label>
            <div class="picker-actions">
              <UiButton :disabled="!selected.length" @click="importCommands"
                >Добавить выбранные</UiButton
              >
              <UiButton @click="discovered = null">Отмена</UiButton>
            </div>
          </template>
          <template v-else>
            <UiHint>{{
              discovered.length
                ? "Все найденные команды уже добавлены."
                : "В этой папке нет скриптов package.json. Добавьте свою команду."
            }}</UiHint>
            <UiButton @click="discovered = null">Закрыть</UiButton>
          </template>
        </div>
        <div class="commands">
          <div v-for="(command, index) in draft.commands" :key="command.id" class="command">
            <label class="field"
              >Название<input
                v-model="command.name"
                :aria-label="`Название команды ${index + 1}`"
                required
                placeholder="dev"
            /></label>
            <label class="field command-input"
              >Команда запуска<input
                v-model="command.cmd"
                :aria-label="`Команда запуска ${index + 1}`"
                class="command-text"
                required
                placeholder="pnpm dev"
                spellcheck="false"
            /></label>
            <UiButton
              variant="ghost"
              :disabled="draft.commands.length === 1"
              :aria-label="`Удалить команду ${command.name || index + 1}`"
              :title="
                draft.commands.length === 1 ? 'Нужна хотя бы одна команда' : 'Удалить команду'
              "
              @click="removeCommand(command.id)"
              ><IconTrash aria-hidden="true"
            /></UiButton>
          </div>
        </div>
        <UiButton class="add-command" @click="addCommand"
          ><IconPlus aria-hidden="true" />Добавить команду</UiButton
        >
      </section>

      <section class="settings-section">
        <h2>Запуск</h2>
        <label class="field"
          >Команда по умолчанию
          <select v-model="draft.defaultCommandId">
            <option
              v-for="(command, index) in draft.commands"
              :key="command.id"
              :value="command.id"
            >
              {{ command.name || `Команда ${index + 1}` }}
            </option>
          </select>
        </label>
        <UiHint>Используется при запуске проекта из палитры и списка проектов.</UiHint>
        <label class="field"
          >Адрес приложения<input
            v-model="draft.url"
            type="url"
            placeholder="Необязательно, например http://localhost:5173"
            spellcheck="false"
        /></label>
        <label class="checkbox"
          ><input
            :checked="draft.mode === 'window'"
            type="checkbox"
            @change="draft.mode = ($event.target as HTMLInputElement).checked ? 'window' : 'server'"
          />Открывать приложение в отдельном окне после запуска</label
        >
        <UiHint
          >Без автоматического открытия команда работает в терминале. Изменения применятся при
          следующем запуске.</UiHint
        >
      </section>
    </fieldset>

    <div class="save-bar">
      <span class="save-status" role="status">{{
        notice || (dirty ? "Есть несохранённые изменения" : "Нет изменений")
      }}</span>
      <UiButton :disabled="busy || !dirty" @click="reset()">Сбросить</UiButton>
      <UiButton variant="solid" type="submit" :disabled="busy || !dirty">{{
        busy ? "сохраняю…" : "Сохранить"
      }}</UiButton>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="dirty && validation" class="error" role="status">{{ validation }}</p>

    <section class="remove-section">
      <div>
        <h2>Убрать из Projector</h2>
        <UiHint>Файлы останутся на диске. Терминалы и процессы проекта будут завершены.</UiHint>
      </div>
      <UiButton variant="danger" :disabled="busy" @click="remove">Убрать проект</UiButton>
    </section>
  </form>
</template>

<style scoped>
.project-settings-form {
  max-width: 760px;
  margin: 0 auto;
  font-size: var(--fs-xs);
}
fieldset {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.settings-section {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4) 0;
  border-bottom: 1px solid var(--line);
}
.settings-section:first-child {
  padding-top: var(--sp-1);
}
h2 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 500;
}
.field {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
  color: var(--muted);
}
.field input,
.field select {
  color: var(--text);
  font-size: var(--fs-xs);
}
.project-root {
  color: var(--muted);
  overflow-wrap: anywhere;
  font-size: var(--fs-2xs);
  user-select: all;
}
.appearance summary {
  color: var(--muted);
  cursor: pointer;
}
.appearance .field {
  margin: var(--sp-3) 0 var(--sp-2);
}
.section-heading,
.picker-actions,
.save-bar,
.remove-section {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.section-heading {
  justify-content: space-between;
  flex-wrap: wrap;
}
.commands {
  display: grid;
  gap: var(--sp-4);
}
.command {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(140px, 3fr) 34px;
  gap: var(--sp-2);
}
.command button {
  align-self: end;
  padding: var(--sp-2);
}
.command-text {
  font-family: var(--mono);
}
.add-command {
  justify-self: start;
}
svg {
  width: 14px;
  height: 14px;
}
.checkbox {
  display: flex;
  align-items: start;
  gap: var(--sp-2);
  color: var(--muted);
}
.checkbox input,
.script-option input {
  width: auto;
  margin: var(--sp-1) 0 0;
  flex-shrink: 0;
}
.script-picker {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: var(--sp-3);
  display: grid;
  gap: var(--sp-3);
}
.script-option {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
}
.script-option code {
  margin-left: auto;
  color: var(--muted);
  overflow-wrap: anywhere;
  min-width: 0;
}
.save-bar {
  position: sticky;
  bottom: calc(var(--sp-4) * -1);
  padding: var(--sp-3) 0;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
  z-index: var(--z-sticky);
}
.save-status {
  color: var(--muted);
  margin-right: auto;
  font-size: var(--fs-2xs);
}
.error {
  color: var(--err);
  margin: var(--sp-3) 0;
}
.remove-section {
  justify-content: space-between;
  padding: var(--sp-5) 0 var(--sp-2);
  flex-wrap: wrap;
}
.remove-section :deep(.hint) {
  margin-top: var(--sp-2);
}
@container (max-width: 500px) {
  .command {
    grid-template-columns: minmax(0, 1fr) 34px;
  }
  .command-input {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .command button {
    grid-column: 2;
    grid-row: 1;
  }
}
@container (max-width: 450px) {
  .script-option {
    flex-wrap: wrap;
  }
  .script-option code {
    flex-basis: 100%;
    margin-left: var(--sp-5);
  }
}
</style>
