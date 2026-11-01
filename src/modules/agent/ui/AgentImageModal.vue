<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiDialog from "../../../common/ui/UiDialog.vue";
import ImageViewport from "../../../common/ui/ImageViewport.vue";
import IconX from "~icons/lucide/x";

const props = defineProps<{ src: string; alt: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<InstanceType<typeof UiDialog>>();
const title = computed(() => props.alt || "Изображение");

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  emit("close");
  dialog.value?.close();
}
// Escape closes the native dialog itself; the other paths emit first, so a second emit is skipped.
function closed() {
  if (closing) return;
  closing = true;
  emit("close");
}
function backdrop(event: MouseEvent) {
  if (event.target === dialog.value?.element) close();
}
function cancel(event: Event) {
  event.preventDefault();
  close();
}
onMounted(() => dialog.value?.open());
</script>

<template>
  <UiDialog
    ref="dialog"
    class="image-modal"
    :label="alt || 'Просмотр изображения'"
    width="1400px"
    style="padding: 0; overflow: hidden"
    @cancel="cancel"
    @close="closed"
    @click="backdrop"
  >
    <div class="frame">
      <header class="modal-head">
        <span class="modal-title u-truncate" :title="title">{{ title }}</span>
        <UiButton
          shape="icon"
          class="image-modal-close"
          aria-label="Закрыть"
          title="Закрыть"
          @click="close()"
        >
          <IconX aria-hidden="true" />
        </UiButton>
      </header>
      <div class="stage">
        <ImageViewport :src="src" :alt="alt" :identity="src" background="transparent" />
      </div>
    </div>
  </UiDialog>
</template>

<style scoped>
.frame {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: min(86dvh, 1000px);
  min-height: 0;
}
.modal-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--line);
  background: var(--bg-2);
}
.modal-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--text);
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: var(--sp-2) 0 0;
}

@media (max-width: 700px), (max-height: 520px) and (max-width: 1000px) {
  /* A phone gets the whole screen: a small floating panel only gets in the way. */
  .image-modal {
    inset: 0 !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  .frame {
    height: 100dvh;
  }
  .modal-head {
    padding-top: max(var(--sp-2), env(safe-area-inset-top));
    padding-right: max(var(--sp-2), env(safe-area-inset-right));
    padding-left: max(var(--sp-4), env(safe-area-inset-left));
  }
  .image-modal-close {
    min-width: 40px;
    min-height: 40px;
  }
  .stage {
    padding: 0;
  }
  .stage :deep(.view-controls) {
    padding-bottom: max(var(--sp-1), env(safe-area-inset-bottom));
    gap: var(--sp-1) var(--sp-2);
  }
}
</style>
