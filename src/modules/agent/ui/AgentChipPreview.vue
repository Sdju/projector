<script setup lang="ts">
import UiPopupSurface from "../../../common/ui/UiPopupSurface.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { workspaceAssetUrl } from "../../workspace-api/index.ts";
import type { MessageChip } from "../model/types.ts";

const props = defineProps<{ projectId: string; scope: HTMLElement | undefined }>();

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const SHOW_DELAY_MS = 220;

const chip = ref<MessageChip>();
const place = ref({ left: 0, top: 0, below: false });
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let current: HTMLElement | undefined;

/** The image a chip stands for: an attachment, or a project file that is a picture. */
function sourceOf(value: MessageChip | undefined): string {
  if (!value) return "";
  if (value.type === "image") return `/api/agent/attachments/${encodeURIComponent(value.id)}`;
  if (value.type === "file" && !value.directory && IMAGE_PATH.test(value.path))
    return workspaceAssetUrl(props.projectId, value.path, value.path.startsWith("/"));
  return "";
}
const source = computed(() => sourceOf(chip.value));

function chipOf(target: EventTarget | null): HTMLElement | undefined {
  return (
    (target instanceof Element ? target.closest<HTMLElement>("[data-chip]") : null) ?? undefined
  );
}
function hide() {
  clearTimeout(timer);
  current = undefined;
  chip.value = undefined;
}
function over(event: MouseEvent) {
  const element = chipOf(event.target);
  if (element === current) return;
  hide();
  if (!element?.dataset.chip) return;
  let value: MessageChip;
  try {
    value = JSON.parse(element.dataset.chip) as MessageChip;
  } catch {
    return;
  }
  if (!sourceOf(value)) return;
  current = element;
  timer = setTimeout(() => {
    const bounds = element.getBoundingClientRect();
    const below = bounds.top < 220;
    failed.value = false;
    place.value = {
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - 280)),
      top: below ? bounds.bottom + 6 : bounds.top - 6,
      below,
    };
    chip.value = value;
  }, SHOW_DELAY_MS);
}

// The scope is the chat: chips are drawn by the editor and by messages, so hovering is delegated.
let bound: HTMLElement | undefined;
function bind(element: HTMLElement | undefined) {
  bound?.removeEventListener("mouseover", over);
  bound?.removeEventListener("mouseleave", hide);
  bound?.removeEventListener("mousedown", hide);
  bound = element;
  bound?.addEventListener("mouseover", over);
  bound?.addEventListener("mouseleave", hide);
  bound?.addEventListener("mousedown", hide);
}
watch(() => props.scope, bind, { immediate: true });
onBeforeUnmount(() => {
  bind(undefined);
  clearTimeout(timer);
});
</script>

<template>
  <Teleport to="body">
    <UiPopupSurface
      v-if="chip && source && !failed"
      class="chip-preview"
      :class="{ below: place.below }"
      :style="{ left: `${place.left}px`, top: `${place.top}px` }"
      role="img"
      :aria-label="chip.type === 'image' ? chip.name : chip.type === 'file' ? chip.path : ''"
    >
      <img :src="source" alt="" @error="failed = true" />
    </UiPopupSurface>
  </Teleport>
</template>

<style scoped>
.chip-preview {
  position: fixed;
  z-index: var(--z-popover);
  transform: translateY(-100%);
  padding: var(--sp-1);
  pointer-events: none;
}
.chip-preview.below {
  transform: none;
}
img {
  display: block;
  max-width: 260px;
  max-height: 200px;
  border-radius: var(--r-md);
  object-fit: contain;
}
</style>
