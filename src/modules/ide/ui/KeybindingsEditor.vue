<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from "vue";
import KeybindingsTable from "./KeybindingsTable.vue";
import type { KeybindingRow as Row } from "./keybinding-row.ts";
import { useIdeCommands } from "../ide.ts";
import {
  editKeybinding,
  recordedKey,
  type Keybinding,
} from "../../../../core/modules/ide/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiDialog from "../../../common/ui/UiDialog.vue";
import UiDialogActions from "../../../common/ui/UiDialogActions.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiKbd from "../../../common/ui/UiKbd.vue";
defineProps<{ embedded?: boolean }>();
const { api, revision } = useIdeCommands();
const search = ref("");
const customOnly = ref(false);
const busy = ref(false);
const error = ref("");
const status = ref("");
const path = ref("");
const dialog = ref<InstanceType<typeof UiDialog>>();
const recorder = ref<HTMLButtonElement>();
const shortcut = ref("");
const editing = ref<Row>();
const rows = computed(() => {
  revision.value;
  const catalog = new Map(api.getCommands().map((command) => [command.id, command.title]));
  const defaults = api.getDefaultKeybindings();
  const overrides = api.getKeybindingOverrides();
  for (const rule of [...defaults, ...overrides])
    if (!catalog.has(rule.command)) catalog.set(rule.command, rule.command);
  const query = search.value.trim().toLocaleLowerCase();
  return [...catalog]
    .flatMap(([command, title]): Row[] => {
      const custom = overrides.some((rule) => rule.command === command);
      const rules = (custom ? overrides : defaults).filter((rule) => rule.command === command);
      return (rules.length ? rules : [undefined]).map((rule, index) => ({
        command,
        title,
        rule,
        index,
        custom,
      }));
    })
    .filter(
      (row) =>
        (!customOnly.value || row.custom) &&
        `${row.title} ${row.command} ${displayKey(row.rule?.key)} ${condition(row.rule)}`
          .toLocaleLowerCase()
          .includes(query),
    )
    .sort((a, b) => a.title.localeCompare(b.title, "ru") || a.command.localeCompare(b.command));
});
// Что штатный агент видит во вкладке горячих клавиш: фильтры, число строк и открытый диалог.
useTabReadout(() => {
  const row = editing.value;
  return {
    note: "Горячие клавиши",
    text: readoutLines(
      search.value ? `Поиск: «${search.value}»` : "",
      `Только изменённые: ${customOnly.value ? "да" : "нет"}`,
      `Показано строк: ${rows.value.length}`,
      `Пользовательских привязок: ${api.getKeybindingOverrides().length}`,
      row ? `Изменить: ${row.title} (${row.command})` : "",
      row ? `Новое сочетание: ${displayKey(shortcut.value) || "не задано"}` : "",
      busy.value ? "Сохранение и загрузка…" : "",
      status.value ? `Статус: ${status.value}` : "",
      error.value ? `Ошибка: ${error.value}` : "",
    ),
  };
});
function displayKey(key?: string) {
  return (
    key
      ?.replace(/Mod/g, navigator.platform.includes("Mac") ? "Meta" : "Ctrl")
      .replace(/ /g, "Space") ?? ""
  );
}
function condition(rule?: Keybinding) {
  return (
    Object.entries(rule?.when ?? {})
      .map(([key, value]) => `${key} = ${value}`)
      .join(" · ") || "В области команды"
  );
}
async function persist(bindings: Keybinding[]) {
  if (busy.value) return false;
  busy.value = true;
  error.value = "";
  status.value = "";
  try {
    await api.saveKeybindings(bindings);
    status.value = "Сохранено";
    return true;
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value);
    return false;
  } finally {
    busy.value = false;
  }
}
function commandRow(value?: unknown) {
  const args = commandArgs(value);
  const row = rows.value.find(
    (entry) => entry.command === args.command && entry.index === args.index,
  );
  if (!row) throw new Error("Привязка не найдена");
  return row;
}
const commands = useCommandScope(`keybindings:${useId()}`, () => ({ surface: "keybindings" }));
for (const [action, title, run] of [
  ["edit", "Изменить сочетание клавиш", (args?: unknown) => startEdit(commandRow(args))],
  ["remove", "Удалить сочетание клавиш", (args?: unknown) => remove(commandRow(args))],
  ["reset", "Сбросить сочетания команды", (args?: unknown) => reset(commandRow(args))],
  ["save", "Сохранить сочетание клавиш", () => accept()],
] as const)
  commands.scope.registerCommand({
    id: `ide.keybindings.${action}`,
    palette: false,
    title,
    run,
    enabled: () => !busy.value,
  });
function run(action: string, row?: Row) {
  commands.run(`ide.keybindings.${action}`, row && { command: row.command, index: row.index });
}
async function startEdit(row: Row) {
  editing.value = row;
  shortcut.value = "";
  await nextTick();
  dialog.value?.open();
  recorder.value?.focus();
}
function record(event: KeyboardEvent) {
  // Dialog navigation stays native; actual shortcuts go through the shared recorder.
  if (event.key === "Tab" || event.key === "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  const key = recordedKey(event);
  if (key) shortcut.value = key;
}
async function accept() {
  const row = editing.value;
  if (!row || !shortcut.value) return;
  if (
    await persist(
      editKeybinding(
        api.getDefaultKeybindings(),
        api.getKeybindingOverrides(),
        row.command,
        row.index,
        shortcut.value,
      ),
    )
  )
    dialog.value?.close();
}
async function remove(row: Row) {
  await persist(
    editKeybinding(
      api.getDefaultKeybindings(),
      api.getKeybindingOverrides(),
      row.command,
      row.index,
      null,
    ),
  );
}
async function reset(row: Row) {
  await persist(api.getKeybindingOverrides().filter((rule) => rule.command !== row.command));
}
onMounted(async () => {
  busy.value = true;
  try {
    path.value = (await api.reloadKeybindings()).path;
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value);
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <section
    class="keybindings-editor"
    :class="{ embedded }"
    aria-label="Настройки горячих клавиш"
    :aria-busy="busy"
    @focusin="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <header>
      <h2 v-if="!embedded">Горячие клавиши</h2>
      <p v-if="!embedded">Сочетания клавиш для команд IDE</p>
      <input
        v-model="search"
        type="search"
        aria-label="Поиск горячих клавиш"
        placeholder="Найти команду или сочетание клавиш…"
      />
      <div class="filters">
        <label><input v-model="customOnly" type="checkbox" /> Только изменённые</label
        ><span>{{ rows.length }} команд и привязок</span>
      </div>
    </header>
    <p v-if="error" class="message error" role="alert">{{ error }}</p>
    <p class="message" role="status">{{ busy ? "Сохранение и загрузка…" : status }}</p>
    <KeybindingsTable
      :rows="rows"
      :busy="busy"
      :reset-key="`${search}:${customOnly}`"
      :display-key="displayKey"
      :condition="condition"
      @action="run"
    />
    <footer :title="path">Изменения применяются сразу{{ path ? ` · ${path}` : "" }}</footer>
    <UiDialog
      ref="dialog"
      labelledby="keybinding-dialog-title"
      @cancel="busy && $event.preventDefault()"
      @keydown.stop
    >
      <form @submit.prevent="run('save')">
        <h3 id="keybinding-dialog-title">Новое сочетание клавиш</h3>
        <p>{{ editing?.title }}</p>
        <small>{{ editing?.command }}</small>
        <button
          ref="recorder"
          type="button"
          class="recorder"
          aria-label="Записать сочетание клавиш"
          :disabled="busy"
          @keydown="record"
        >
          <UiKbd v-if="shortcut">{{ displayKey(shortcut) }}</UiKbd
          ><span v-else>Нажмите сочетание клавиш</span>
        </button>
        <UiHint>Tab — перейти к кнопкам · Esc — отменить</UiHint>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <UiDialogActions>
          <UiButton :disabled="busy" @click="dialog?.close()">Отмена</UiButton>
          <UiButton variant="solid" type="submit" :disabled="busy || !shortcut">Сохранить</UiButton>
        </UiDialogActions>
      </form>
    </UiDialog>
  </section>
</template>

<style scoped>
.keybindings-editor {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: var(--fs-xs);
  background: var(--bg);
}
.keybindings-editor.embedded {
  height: max(360px, calc(100dvh - 260px));
}
.embedded header {
  padding: 0;
}
.embedded .message {
  padding-inline: 0;
}
.embedded footer {
  padding-inline: 0;
}
header {
  padding: var(--sp-4) var(--sp-5) 0;
}
h2 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-lg);
  font-weight: 500;
}
header p {
  margin: 0 0 var(--sp-4);
  color: var(--muted);
}
header > input {
  width: 100%;
  font-size: var(--fs-sm);
}
.filters {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) 0 0;
  color: var(--muted);
}
.filters label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.filters input {
  width: auto;
}
.message {
  margin: 0;
  padding: var(--sp-1) var(--sp-5);
  min-height: 24px;
  color: var(--muted);
}
.error {
  color: var(--err);
}
footer {
  padding: var(--sp-2) var(--sp-5);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--fs-2xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
h3 {
  font-size: var(--fs-md);
  margin: 0 0 var(--sp-4);
}
.recorder {
  display: block;
  transition: background var(--t-fast);
  width: 100%;
  padding: var(--sp-4);
  margin-top: var(--sp-4);
  border: 1px solid var(--focus);
  border-radius: var(--r-sm);
  text-align: center;
}
.recorder:hover:not(:disabled) {
  background: var(--hover);
}
@media (max-width: 700px) {
  header {
    padding: var(--sp-3) var(--sp-3) 0;
  }
  .filters {
    flex-wrap: wrap;
  }
}
</style>
