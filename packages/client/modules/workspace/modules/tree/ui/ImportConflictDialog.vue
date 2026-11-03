<script setup lang="ts">
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import { computed, nextTick, ref, useId } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiDialog from "../../../../../common/ui/UiDialog.vue";
import UiDialogActions from "../../../../../common/ui/UiDialogActions.vue";
import UiControl, { type UiControlHandle } from "../../../../../common/ui/UiControl.vue";
import UiField from "../../../../../common/ui/UiField.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import type { ImportConflict } from "../../../../workspace-api/index.ts";
import type { ImportChoice } from "../lib/tree-import.ts";

const titleId = useId();
const dialog = ref<InstanceType<typeof UiDialog>>();
const input = ref<UiControlHandle>();
const directory = ref("");
const conflicts = ref<ImportConflict[]>([]);
const prefix = ref("copy-");
const error = ref("");
const busy = ref(false);
let settle: ((choice: ImportChoice | undefined) => void) | undefined;
let validate: (prefix: string) => Promise<string>;
let trigger: HTMLElement | null = null;

const single = computed(() => conflicts.value.length === 1);
const shown = computed(() => conflicts.value.slice(0, 6));

/** Спрашивает, что делать с занятыми именами. `undefined` — отмена. */
function ask(options: {
  directory: string;
  conflicts: ImportConflict[];
  validatePrefix: (prefix: string) => Promise<string>;
}) {
  settle?.(undefined);
  trigger = document.activeElement as HTMLElement | null;
  directory.value = options.directory;
  conflicts.value = options.conflicts;
  validate = options.validatePrefix;
  error.value = "";
  busy.value = false;
  dialog.value?.open();
  void nextTick(() => input.value?.select());
  return new Promise<ImportChoice | undefined>((resolve) => {
    settle = resolve;
  });
}
function finish(choice?: ImportChoice) {
  const done = settle;
  settle = undefined;
  dialog.value?.close();
  if (trigger?.isConnected) trigger.focus();
  done?.(choice);
}
async function applyPrefix() {
  const value = prefix.value.trim();
  if (!value || busy.value) return;
  busy.value = true;
  try {
    error.value = await validate(value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось проверить префикс";
  }
  busy.value = false;
  if (!error.value) finish({ kind: "prefix", prefix: value });
}
defineExpose({ ask });
</script>

<template>
  <Teleport to="body">
    <UiDialog
      ref="dialog"
      :labelledby="titleId"
      @cancel="busy ? $event.preventDefault() : finish()"
    >
      <form @submit.prevent="single ? undefined : applyPrefix()">
        <UiHeading :id="titleId" class="title">
          {{ single ? `«${conflicts[0]!.name}» уже существует` : "Имена уже заняты" }}
        </UiHeading>
        <UiHint size="xs" :space-after="3" wrap>
          В папке «{{ directory || "корень проекта" }}»
          {{ single ? "уже есть запись с таким именем." : `занято записей: ${conflicts.length}:` }}
        </UiHint>
        <ul v-if="!single">
          <li v-for="item in shown" :key="item.name">{{ item.name }}</li>
          <li v-if="conflicts.length > shown.length">
            и ещё {{ conflicts.length - shown.length }}
          </li>
        </ul>
        <template v-if="!single">
          <UiField
            v-slot="{ control }"
            layout="plain"
            label="Добавить префикс ко всем занятым именам"
            class="prefix"
            required
          >
            <UiControl
              v-bind="control"
              ref="input"
              v-model="prefix"
              maxlength="64"
              :disabled="busy"
            />
          </UiField>
          <UiMessage v-if="error" class="error" tone="danger" size="xs" role="alert">{{
            error
          }}</UiMessage>
        </template>
        <UiDialogActions>
          <UiButton :disabled="busy" @click="finish()">Отмена</UiButton>
          <template v-if="single">
            <UiButton @click="finish({ kind: 'keep' })">
              Оставить оба ({{ conflicts[0]!.free }})
            </UiButton>
            <UiButton tone="danger" @click="finish({ kind: 'replace' })">Заменить</UiButton>
          </template>
          <UiButton v-else type="submit" appearance="solid" :disabled="busy || !prefix.trim()">
            {{ busy ? "Проверка…" : "Добавить префикс" }}
          </UiButton>
        </UiDialogActions>
      </form>
    </UiDialog>
  </Teleport>
</template>

<style scoped>
.title {
  overflow-wrap: anywhere;
}
ul {
  margin: 0 0 var(--sp-3);
  padding-left: var(--sp-5);
  font-size: var(--fs-xs);
  color: var(--text);
  overflow-wrap: anywhere;
}
.prefix {
  font-size: var(--fs-xs);
}
.error {
  margin: var(--sp-2) 0 0;
  overflow-wrap: anywhere;
}
</style>
