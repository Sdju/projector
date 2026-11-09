<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  /** Подпись для скринридеров, если у диалога нет видимого заголовка. */
  label?: string;
  labelledby?: string;
  /** `top` — как командная палитра, `center` — как обычный диалог. */
  align?: "center" | "top";
  width?: string;
  /** On a phone the dialog takes the whole screen. */
  fullscreen?: boolean;
  /** No inner padding: the owner draws edge-to-edge content. */
  flush?: boolean;
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
    :class="[align ?? 'center', { fullscreen, flush }]"
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

.ui-dialog.flush {
  padding: 0;
  overflow: hidden;
}
.ui-dialog::backdrop {
  background: var(--overlay);
}
@media (max-width: 700px), (max-height: 520px) and (max-width: 1000px) {
  .ui-dialog.fullscreen {
    inset: 0;
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
}
@media (max-width: 700px) {
  .ui-dialog {
    width: calc(100vw - var(--sp-2) * 2);
    max-height: calc(100dvh - var(--sp-2) * 2);
    padding: var(--sp-4);
  }
  .ui-dialog.top {
    top: max(var(--sp-2), env(safe-area-inset-top));
    padding: var(--sp-2);
    max-height: calc(100dvh - var(--sp-4));
  }
}
</style>
