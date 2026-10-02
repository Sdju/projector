<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useIdeCommands } from "../ide.ts";
const { api, palette, reportError } = useIdeCommands();
const route = useRoute();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const query = ref("");
const selected = ref(-1);
const results = computed(() => {
  const tokens = query.value
    .trim()
    .replace(/^>\s*/, "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return (palette.value?.commands ?? []).filter((command) =>
    tokens.every((token) =>
      `${command.title} ${command.id} ${command.group}`.toLocaleLowerCase().includes(token),
    ),
  );
});
function close(restoreFocus = true) {
  const trigger = palette.value?.trigger;
  palette.value = null;
  dialog.value?.close();
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}
async function revealSelected() {
  await nextTick();
  dialog.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}
watch(results, () => {
  selected.value = results.value.findIndex((command) => command.enabled);
  void revealSelected();
});
watch(palette, async (session) => {
  if (!session) return;
  query.value = "";
  selected.value = results.value.findIndex((command) => command.enabled);
  await nextTick();
  dialog.value?.showModal();
  input.value?.focus();
});
watch(
  () => route.fullPath,
  () => close(false),
);
function move(direction: number) {
  const available = results.value.flatMap((command, index) => (command.enabled ? [index] : []));
  if (!available.length) return;
  const position = available.indexOf(selected.value);
  selected.value = available[(position + direction + available.length) % available.length]!;
  void revealSelected();
}
async function execute(index = selected.value) {
  const command = results.value[index];
  if (!command?.enabled) return;
  close();
  await nextTick();
  try {
    await api.executeCommand(command.id, undefined, { scope: command.scope });
  } catch (value) {
    reportError(value);
  }
}
function keydown(event: KeyboardEvent) {
  if (event.target !== input.value || event.isComposing || event.keyCode === 229) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    move(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    void execute();
  }
}
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    close();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="command-palette"
    aria-label="Командный центр"
    @keydown="keydown"
    @cancel.prevent="close()"
    @close="palette && close()"
    @click="backdrop"
  >
    <div class="search">
      <span aria-hidden="true">&gt;</span
      ><input
        ref="input"
        v-model="query"
        role="combobox"
        aria-label="Найти команду"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="command-palette-results"
        :aria-activedescendant="selected >= 0 ? `palette-option-${selected}` : undefined"
        placeholder="Введите название или ID команды…"
        autocomplete="off"
      /><button aria-label="Закрыть командный центр" title="Закрыть (Esc)" @click="close()">
        ×
      </button>
    </div>
    <ul id="command-palette-results" role="listbox" aria-label="Команды IDE">
      <li
        v-for="(command, index) in results"
        :id="`palette-option-${index}`"
        :key="`${command.scope}:${command.id}`"
        role="option"
        :aria-selected="selected === index"
        :aria-disabled="!command.enabled"
        :data-command="command.id"
        :class="{ selected: selected === index, unavailable: !command.enabled }"
        @pointermove="command.enabled && (selected = index)"
      >
        <button :disabled="!command.enabled" tabindex="-1" @click="execute(index)">
          <span class="description"
            ><span class="title">{{ command.group }}: {{ command.title }}</span
            ><small>{{ command.id }}</small></span
          ><kbd v-if="command.shortcut">{{ command.shortcut }}</kbd
          ><span v-if="!command.enabled" class="unavailable-label">Недоступно</span>
        </button>
      </li>
    </ul>
    <p v-if="!results.length" class="empty" role="status">Команды не найдены</p>
    <footer>
      <span>↑ ↓ выбор · Enter запуск · Esc закрыть</span><span>{{ results.length }} команд</span>
    </footer>
  </dialog>
</template>

<style scoped>
.command-palette {
  position: fixed;
  inset: 70px 0 auto;
  width: min(660px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 6px;
  max-height: calc(100dvh - 100px);
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--bg-2);
  color: var(--text);
  box-shadow: 0 18px 70px #0009;
  overflow: hidden;
}
.command-palette::backdrop {
  background: #0005;
}
.search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border: 1px solid var(--focus);
  border-radius: 4px;
}
.search > span {
  color: var(--muted);
  font: 16px var(--mono);
}
.search input {
  flex: 1;
  width: 0;
  min-width: 0;
  padding: 6px 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.search button {
  color: var(--muted);
  padding: 0 4px;
  font-size: 20px;
}
ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  overflow: auto;
  max-height: min(480px, calc(100dvh - 205px));
}
li {
  border-radius: 3px;
}
li.selected {
  background: color-mix(in srgb, var(--focus) 16%, var(--bg-2));
  outline: 1px solid color-mix(in srgb, var(--focus) 45%, transparent);
  outline-offset: -1px;
}
li button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  color: inherit;
}
.description {
  flex: 1;
  min-width: 0;
}
.title {
  display: block;
  font-size: 13px;
}
small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font: 10px var(--mono);
  overflow-wrap: anywhere;
}
kbd {
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 2px 5px;
  font: 10px var(--mono);
  color: var(--muted);
}
.unavailable {
  opacity: 0.45;
}
.unavailable-label {
  font-size: 10px;
  color: var(--muted);
}
.empty {
  padding: 20px 12px;
  font-size: 13px;
  color: var(--muted);
}
footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px 3px;
  border-top: 1px solid var(--line);
  font-size: 10px;
  color: var(--muted);
}
@media (max-width: 600px) {
  .command-palette {
    top: 20px;
    max-height: calc(100dvh - 40px);
  }
  ul {
    max-height: calc(100dvh - 130px);
  }
  li button {
    gap: 6px;
    padding: 8px;
  }
  .unavailable-label {
    display: none;
  }
}
</style>
