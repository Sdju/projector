<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import ImageModal from "../../../../common/ui/ImageModal.vue";
import { chatImageSource, chatProjectKey } from "../../../chat-images/index.ts";

const props = defineProps<{
  src: string;
  alt: string;
  caption?: string;
  fit?: "contain" | "cover";
  height?: number;
}>();

/** Same resolution as a markdown picture: a project file, a file on disk, a web address or data. */
const projectId = inject(chatProjectKey, "");
const source = computed(() => chatImageSource(props.src, projectId));
const style = computed(() => ({
  height: `${Math.max(80, Math.min(1200, props.height ?? 240))}px`,
  objectFit: props.fit ?? "contain",
}));

/** A source that failed to load leaves a link with the alt text, not a broken icon. */
const failed = ref(false);
const viewing = ref<string>();

watch(source, () => {
  failed.value = false;
  viewing.value = undefined;
});
</script>

<template>
  <figure class="image">
    <button
      v-if="source && !failed"
      type="button"
      class="preview"
      :aria-label="alt ? `Открыть изображение: ${alt}` : 'Открыть изображение'"
      @click="viewing = source"
    >
      <img
        :src="source"
        :alt="alt"
        :style="style"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="failed = true"
      />
    </button>
    <a
      v-else-if="source"
      class="image-text"
      :href="source"
      target="_blank"
      rel="noopener noreferrer"
      >{{ alt || "Изображение" }}</a
    >
    <span v-else class="image-text">{{ alt || "Изображение" }}</span>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
  <ImageModal v-if="viewing" :src="viewing" :alt="alt" @close="viewing = undefined" />
</template>

<style scoped>
.image {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  min-width: 0;
}
.preview {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--r-md);
  background: none;
  cursor: zoom-in;
}
img {
  display: block;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
}
.image-text {
  color: var(--muted);
  font-size: var(--fs-2xs);
  overflow-wrap: anywhere;
}
figcaption {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
