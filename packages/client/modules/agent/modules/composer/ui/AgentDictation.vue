<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, useId } from "vue";
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import { useCommandScope } from "../../../../../common/utilities/commands.ts";
import { useDictation } from "../../../../dictation/index.ts";
import { appSettingsSection } from "../../../../settings/index.ts";

const props = defineProps<{
  projectId?: string;
  input?: {
    beginDictation(): void;
    insertDictation(text: string): void;
    cancelDictation(): void;
  };
}>();
const dictation = reactive(
  useDictation({
    begin: () => props.input?.beginDictation(),
    insert: (text) => props.input?.insertDictation(text),
  }),
);
const commands = useCommandScope(`dictation:${useId()}`, () => ({
  surface: "agent-chat",
  project: props.projectId ?? null,
  dictating: dictation.phase !== "idle",
}));
const time = computed(() => {
  const seconds = Math.floor(dictation.elapsed);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});

async function start() {
  await nextTick();
  await dictation.start();
}
async function cancel() {
  props.input?.cancelDictation();
  await dictation.cancel();
}

// The hook releases the microphone on unmount too; this wrapper also drops the saved range.
onBeforeUnmount(() => void cancel());

commands.scope.registerCommand({
  id: "ide.dictation.start",
  palette: false,
  title: "Начать диктовку",
  description: "Начинает запись микрофона для последующей вставки распознанного текста в черновик.",
  enabled: () => dictation.available && dictation.phase !== "recording",
  run: start,
});
commands.scope.registerCommand({
  id: "ide.dictation.stop",
  palette: false,
  title: "Завершить диктовку",
  description: "Останавливает запись и отправляет звук выбранной ролью Listener модели.",
  enabled: () => dictation.phase === "recording",
  run: dictation.stop,
});
commands.scope.registerCommand({
  id: "ide.dictation.toggle",
  palette: false,
  title: "Начать или завершить диктовку",
  description: "Переключает запись микрофона; распознанный текст вставляется только в черновик.",
  enabled: () => dictation.available && dictation.phase !== "transcribing",
  run: () => (dictation.phase === "recording" ? dictation.stop() : start()),
});
commands.scope.registerCommand({
  id: "ide.dictation.retry",
  palette: false,
  title: "Повторить распознавание",
  description:
    "Повторно отправляет сохранённый в памяти звук после ошибки, не записывая его заново.",
  enabled: () => dictation.phase === "error",
  run: dictation.retry,
});
commands.scope.registerCommand({
  id: "ide.dictation.cancel",
  palette: false,
  title: "Отменить диктовку",
  description:
    "Останавливает запись или распознавание и удаляет звук из памяти без вставки текста.",
  enabled: () => dictation.phase !== "idle",
  run: cancel,
});
commands.scope.registerCommand({
  id: "ide.dictation.settings.open",
  palette: false,
  title: "Настроить Listener",
  description: "Открывает роль Listener: модель распознавания и контекст с именами и терминами.",
  run: async () => {
    appSettingsSection.value = "agent-roles";
    await commands.scope.executeCommand("ide.workbench.settings.open");
  },
});

function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || dictation.phase === "idle") return;
  event.preventDefault();
  event.stopPropagation();
  void cancel();
}
async function beforeSubmit(): Promise<boolean> {
  if (dictation.phase === "transcribing") return false;
  if (dictation.phase === "recording") await dictation.stop();
  return dictation.phase !== "error";
}
defineExpose({
  beforeSubmit,
  phase: computed(() => dictation.phase),
  escape,
  keydown: commands.keydown,
  activate: commands.scope.activate,
});
</script>

<template>
  <div v-if="dictation.phase === 'error'" class="dictation-error" role="alert">
    <span>{{ dictation.error }}</span>
    <button type="button" @click="commands.run('ide.dictation.retry')">Повторить</button>
    <button
      type="button"
      aria-label="Закрыть ошибку диктовки"
      @click="commands.run('ide.dictation.cancel')"
    >
      <ProjectorIcon name="x" aria-hidden="true" />
    </button>
  </div>
  <span v-if="dictation.phase === 'recording'" class="dictation-status" role="status">
    <span class="dictation-level" :style="{ '--level': dictation.level }" />
    {{ time }}
  </span>
  <span v-else-if="dictation.phase === 'transcribing'" class="dictation-status" role="status">
    Распознаём…
  </span>
  <UiButton
    v-if="dictation.available && dictation.phase !== 'transcribing'"
    shape="icon"
    size="sm"
    class="dictation-button"
    :class="{ recording: dictation.phase === 'recording' }"
    :title="
      dictation.phase === 'recording'
        ? 'Завершить диктовку (Mod+Shift+D)'
        : 'Начать диктовку (Mod+Shift+D)'
    "
    :aria-label="dictation.phase === 'recording' ? 'Завершить диктовку' : 'Начать диктовку'"
    :aria-pressed="dictation.phase === 'recording'"
    @click="commands.run('ide.dictation.toggle')"
  >
    <ProjectorIcon :name="dictation.phase === 'recording' ? 'square' : 'mic'" aria-hidden="true" />
  </UiButton>
  <UiButton
    v-else-if="dictation.phase === 'transcribing'"
    shape="icon"
    size="sm"
    class="dictation-button"
    title="Отменить распознавание"
    aria-label="Отменить распознавание"
    @click="commands.run('ide.dictation.cancel')"
  >
    <ProjectorIcon name="x" aria-hidden="true" />
  </UiButton>
</template>

<style scoped>
.dictation-button {
  color: var(--muted);
}
.dictation-button.recording {
  color: var(--err);
  background: color-mix(in srgb, var(--err) 12%, transparent);
}
.dictation-status {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}
.dictation-level {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--err);
  box-shadow: 0 0 0 calc(var(--level) * 5px) color-mix(in srgb, var(--err) 20%, transparent);
}
.dictation-error {
  position: absolute;
  right: var(--sp-5);
  bottom: calc(100% - var(--sp-4));
  left: var(--sp-5);
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  max-height: 30vh;
  margin: 0 0 var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--err) 40%, var(--bg-2));
  border-radius: var(--r-lg);
  background: var(--theme-inset-background, var(--bg-2));
  color: var(--err);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.dictation-error span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.dictation-error button {
  flex-shrink: 0;
  color: inherit;
  text-decoration: underline;
}
</style>
