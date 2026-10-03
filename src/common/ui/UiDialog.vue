<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  /** Подпись для скринридеров, если у диалога нет видимого заголовка. */
  label?: string;
  labelledby?: string;
  /** `top` — как командная палитра, `center` — как обычный диалог. */
  align?: "center" | "top";
  width?: string;
}>();
const emit = defineEmits<{ cancel: [Event]; close: [] }>();
const dialog = ref<HTMLDialogElement>();

defineExpose({
  open: () => dialog.value?.showModal(),
  close: () => dialog.value?.close(),
  get element() {
    return dialog.value;
  },
});
</script>

<template>
  <dialog
    ref="dialog"
    class="ui-dialog"
    :class="align ?? 'center'"
    :style="width ? { '--dialog-width': width } : undefined"
    :aria-label="label"
    :aria-labelledby="labelledby"
    @cancel="emit('cancel', $event)"
    @close="emit('close')"
  >
    <slot />
  </dialog>
</template>

<style scoped>
.ui-dialog {
  width: min(var(--dialog-width, 420px), calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  padding: var(--sp-5);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

.ui-dialog.top {
  position: fixed;
  inset: 70px 0 auto;
  margin: 0 auto;
  padding: var(--sp-2);
  max-height: calc(100dvh - 100px);
  overflow: hidden;
}

.ui-dialog::backdrop {
  background: var(--overlay);
}
</style>
