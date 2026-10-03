<script setup lang="ts">
import UiHint from "../../../common/ui/UiHint.vue";
import { reactive, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiField from "../../../common/ui/UiField.vue";
import type { LaunchMode, ProjectDraft } from "../model/types.ts";

const props = defineProps<{
  modelValue: ProjectDraft;
  submitLabel: string;
  compact?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ProjectDraft];
  submit: [];
  inspect: [path: string];
}>();

const draft = reactive<ProjectDraft>({ ...props.modelValue });
const inspectError = ref("");
let applying = false;

watch(
  () => props.modelValue,
  (value) => {
    applying = true;
    Object.assign(draft, value);
    queueMicrotask(() => {
      applying = false;
    });
  },
  { deep: true },
);

watch(
  draft,
  (value) => {
    if (applying) return;
    emit("update:modelValue", { ...value, commands: value.commands.map((item) => ({ ...item })) });
  },
  { deep: true },
);

function setMode(mode: LaunchMode): void {
  draft.mode = mode;
}

function addCommand(): void {
  draft.commands.push({ id: crypto.randomUUID(), name: "", cmd: "" });
}

function removeCommand(id: string): void {
  if (draft.commands.length === 1) return;
  draft.commands = draft.commands.filter((item) => item.id !== id);
  if (draft.defaultCommandId === id) {
    draft.defaultCommandId = draft.commands[0]?.id ?? "";
  }
}

function onInspect(): void {
  inspectError.value = "";
  if (!draft.path.trim()) {
    inspectError.value = "Укажите путь";
    return;
  }
  emit("inspect", draft.path.trim());
}
</script>

<template>
  <form class="form" :class="{ compact }" @submit.prevent="emit('submit')">
    <UiField label="путь">
      <div class="row">
        <input v-model="draft.path" placeholder="/home/…/проект" spellcheck="false" />
        <UiButton @click="onInspect">прочитать</UiButton>
      </div>
      <UiHint v-if="inspectError" class="err">{{ inspectError }}</UiHint>
    </UiField>

    <UiField label="имя">
      <input v-model="draft.name" placeholder="название" />
    </UiField>

    <UiField label="адрес">
      <input v-model="draft.url" placeholder="http://localhost:5173" spellcheck="false" />
    </UiField>

    <UiField label="режим">
      <div class="row">
        <UiButton variant="chip" :active="draft.mode === 'server'" @click="setMode('server')">
          сервер
        </UiButton>
        <UiButton variant="chip" :active="draft.mode === 'window'" @click="setMode('window')">
          окно
        </UiButton>
      </div>
    </UiField>

    <UiField label="команды">
      <div class="commands">
        <div v-for="command in draft.commands" :key="command.id" class="command">
          <input v-model="command.name" class="name" placeholder="dev" aria-label="Имя команды" />
          <input
            v-model="command.cmd"
            class="command-text"
            aria-label="Команда запуска"
            placeholder="pnpm dev"
            spellcheck="false"
          />
          <label class="def">
            <input v-model="draft.defaultCommandId" type="radio" :value="command.id" />
            осн.
          </label>
          <UiButton
            variant="ghost"
            :aria-label="`Удалить команду ${command.name}`"
            @click="removeCommand(command.id)"
            >×</UiButton
          >
        </div>
        <UiButton variant="ghost" @click="addCommand">+ команда</UiButton>
      </div>
    </UiField>

    <div class="actions">
      <UiButton variant="solid" type="submit">{{ submitLabel }}</UiButton>
    </div>
  </form>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--sp-4);
}

.row {
  display: flex;
  gap: var(--sp-2);
}

.err {
  color: var(--err);
  font-size: var(--fs-xs);
}

.commands {
  display: grid;
  gap: var(--sp-2);
}

.command {
  display: grid;
  grid-template-columns: 90px 1fr auto auto;
  gap: var(--sp-2);
  align-items: center;
}

.name {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.def {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.def input {
  width: auto;
}

.actions {
  display: flex;
  justify-content: flex-end;
}
.compact {
  gap: var(--sp-4);
}
.compact input {
  min-width: 0;
  padding: var(--sp-2) var(--sp-2);
  font-size: var(--fs-xs);
}
.compact .row {
  flex-wrap: wrap;
}
.compact .row > input {
  flex-basis: 100%;
}
.compact .row > button,
.compact .commands > button,
.compact .actions > button {
  font-size: var(--fs-xs);
  padding: var(--sp-1) var(--sp-2);
}
.compact .command {
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--sp-2);
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.compact .command-text {
  grid-column: 1 / -1;
  grid-row: 2;
  font-family: var(--mono);
}
.compact .actions {
  justify-content: flex-start;
}
</style>
