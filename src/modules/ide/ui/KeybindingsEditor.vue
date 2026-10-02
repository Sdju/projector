<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from "vue";
import { useIdeCommands } from "../ide.ts";
import {
  editKeybinding,
  recordedKey,
  type Keybinding,
} from "../../../../core/modules/ide/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import IconEdit from "~icons/lucide/pencil";
import IconReset from "~icons/lucide/rotate-ccw";
import IconRemove from "~icons/lucide/x";
const { api, revision } = useIdeCommands();
const search = ref("");
const customOnly = ref(false);
const busy = ref(false);
const error = ref("");
const status = ref("");
const path = ref("");
const dialog = ref<HTMLDialogElement>();
const recorder = ref<HTMLButtonElement>();
const shortcut = ref("");
interface Row {
  command: string;
  title: string;
  index: number;
  rule?: Keybinding;
  custom: boolean;
}
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
  dialog.value?.showModal();
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
    aria-label="Настройки горячих клавиш"
    :aria-busy="busy"
    @focusin="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <header>
      <h2>Горячие клавиши</h2>
      <p>Сочетания клавиш для команд IDE</p>
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
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Команда</th>
            <th>Сочетание</th>
            <th>Когда</th>
            <th>Источник</th>
            <th><span class="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="`${row.command}:${row.index}`"
            :data-command="row.command"
            @dblclick="!busy && run('edit', row)"
          >
            <td>
              <span>{{ row.title }}</span
              ><small>{{ row.command }}</small>
            </td>
            <td>
              <button
                class="binding"
                :disabled="busy"
                :aria-label="`Изменить сочетание: ${row.command}`"
                @click="run('edit', row)"
              >
                <kbd v-if="row.rule && !row.rule.disabled">{{ displayKey(row.rule.key) }}</kbd
                ><span v-else class="muted">Не назначено</span>
              </button>
            </td>
            <td class="when">{{ condition(row.rule) }}</td>
            <td>{{ row.custom ? "Пользователь" : "По умолчанию" }}</td>
            <td class="actions">
              <button
                :disabled="busy"
                :aria-label="`Изменить: ${row.command}`"
                title="Изменить сочетание"
                @click="run('edit', row)"
              >
                <IconEdit />
              </button>
              <button
                v-if="row.rule && !row.rule.disabled"
                :disabled="busy"
                :aria-label="`Удалить: ${row.command}`"
                title="Удалить привязку"
                @click="run('remove', row)"
              >
                <IconRemove />
              </button>
              <button
                v-if="row.custom"
                :disabled="busy"
                :aria-label="`Сбросить: ${row.command}`"
                title="Восстановить стандартные привязки команды"
                @click="run('reset', row)"
              >
                <IconReset />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty">Команды не найдены</p>
    </div>
    <footer :title="path">Изменения применяются сразу{{ path ? ` · ${path}` : "" }}</footer>
    <dialog
      ref="dialog"
      aria-labelledby="keybinding-dialog-title"
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
          <kbd v-if="shortcut">{{ displayKey(shortcut) }}</kbd
          ><span v-else>Нажмите сочетание клавиш</span>
        </button>
        <p class="hint">Tab — перейти к кнопкам · Esc — отменить</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="dialog?.close()">Отмена</button
          ><button type="submit" :disabled="busy || !shortcut">Сохранить</button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.keybindings-editor {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  background: var(--bg);
}
header {
  padding: 20px 22px 0;
}
h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 500;
}
header p {
  margin: 0 0 18px;
  color: var(--muted);
}
header > input {
  width: 100%;
  font-size: 13px;
}
.filters {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 0 0;
  color: var(--muted);
}
.filters label {
  display: flex;
  align-items: center;
  gap: 7px;
}
.filters input {
  width: auto;
}
.message {
  margin: 0;
  padding: 5px 22px;
  min-height: 24px;
  color: var(--muted);
}
.error {
  color: var(--err);
}
.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-2);
  color: var(--muted);
  font-weight: 500;
  border-bottom: 1px solid var(--line);
}
th,
td {
  padding: 10px 12px;
}
th:first-child,
td:first-child {
  padding-left: 22px;
}
td {
  border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
}
tr:hover td {
  background: var(--bg-2);
}
td:first-child {
  min-width: 180px;
}
small {
  display: block;
  color: var(--muted);
  font: 10px var(--mono);
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.when {
  color: var(--muted);
  font: 10px var(--mono);
  min-width: 130px;
}
.binding {
  text-align: left;
  white-space: nowrap;
  min-height: 26px;
}
kbd {
  display: inline-block;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg-2);
  padding: 3px 7px;
  font: 11px var(--mono);
}
.muted {
  color: var(--muted);
}
.actions {
  white-space: nowrap;
}
.actions button {
  padding: 5px;
  color: var(--muted);
}
.actions button:hover {
  color: var(--text);
}
svg {
  width: 13px;
  height: 13px;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
footer {
  padding: 9px 22px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty {
  padding: 22px;
  color: var(--muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
dialog {
  width: min(420px, calc(100vw - 32px));
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 22px;
  background: var(--bg-2);
  color: var(--text);
  box-shadow: 0 14px 60px #0008;
}
dialog::backdrop {
  background: #0007;
}
h3 {
  font-size: 16px;
  margin: 0 0 14px;
}
.recorder {
  display: block;
  width: 100%;
  padding: 18px;
  margin-top: 20px;
  border: 1px solid var(--focus);
  border-radius: 4px;
  text-align: center;
}
.hint {
  font-size: 11px;
  color: var(--muted);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.dialog-actions button {
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
.dialog-actions button[type="submit"] {
  background: var(--focus);
  color: var(--bg);
}
@media (max-width: 700px) {
  header {
    padding: 12px 12px 0;
  }
  th:first-child,
  td:first-child {
    padding-left: 12px;
  }
  .filters {
    flex-wrap: wrap;
  }
}
</style>
