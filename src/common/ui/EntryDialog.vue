<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import UiButton from "./UiButton.vue";
import UiDialog from "./UiDialog.vue";
import UiDialogActions from "./UiDialogActions.vue";
const emit = defineEmits<{ submit: [value: string]; cancel: [] }>();
const titleId = useId();
const dialog = ref<InstanceType<typeof UiDialog>>();
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
  dialog.value?.open();
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
    <UiDialog
      ref="dialog"
      :labelledby="titleId"
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
        <UiDialogActions>
          <UiButton
            :disabled="busy"
            @click="
              close();
              emit('cancel');
            "
          >
            Отмена
          </UiButton>
          <UiButton
            type="submit"
            :variant="confirm ? 'danger' : 'solid'"
            :disabled="busy || (!confirm && !value.trim())"
          >
            {{ busy ? "Выполняется…" : confirm ? "Удалить" : "Сохранить" }}
          </UiButton>
        </UiDialogActions>
      </form>
    </UiDialog>
  </Teleport>
</template>
<style scoped>
h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-md);
  font-weight: 500;
}
p {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
  color: var(--muted);
}
.error {
  color: var(--err);
}
</style>
