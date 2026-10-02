<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
const emit = defineEmits<{ submit: [value: string]; cancel: [] }>();
const titleId = useId();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const title = ref("");
const value = ref("");
const description = ref("");
const confirm = ref(false);
const error = ref("");
const busy = ref(false);
let trigger: HTMLElement | null = null;
async function open(options: {
  title: string;
  value?: string;
  description?: string;
  confirm?: boolean;
}) {
  trigger = document.activeElement as HTMLElement;
  title.value = options.title;
  value.value = options.value ?? "";
  description.value = options.description ?? "";
  confirm.value = !!options.confirm;
  error.value = "";
  busy.value = false;
  dialog.value?.showModal();
  await nextTick();
  input.value?.focus();
  input.value?.select();
}
function close() {
  dialog.value?.close();
  if (trigger?.isConnected) trigger.focus();
}
function submit() {
  if (busy.value || (!confirm.value && !value.value.trim())) return;
  busy.value = true;
  emit("submit", value.value.trim());
}
function fail(message: string) {
  error.value = message;
  busy.value = false;
}
defineExpose({ open, close, fail });
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="entry-dialog"
      :aria-labelledby="titleId"
      @cancel="busy ? $event.preventDefault() : emit('cancel')"
    >
      <form @submit.prevent="submit">
        <h2 :id="titleId">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
        <input
          v-if="!confirm"
          ref="input"
          v-model="value"
          :aria-label="title"
          :disabled="busy"
          required
          maxlength="255"
        />
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="actions">
          <button
            type="button"
            :disabled="busy"
            @click="
              close();
              emit('cancel');
            "
          >
            Отмена
          </button>
          <button
            type="submit"
            :disabled="busy || (!confirm && !value.trim())"
            :class="{ danger: confirm }"
          >
            {{ busy ? "Выполняется…" : confirm ? "Удалить" : "Сохранить" }}
          </button>
        </div>
      </form>
    </dialog>
  </Teleport>
</template>
<style scoped>
.entry-dialog {
  width: min(420px, calc(100vw - 32px));
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-2);
  color: var(--text);
}
.entry-dialog::backdrop {
  background: #0007;
}
h2 {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 500;
}
p {
  font-size: 12px;
  overflow-wrap: anywhere;
  color: var(--muted);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.actions button {
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
.danger,
.error {
  color: var(--err);
}
</style>
