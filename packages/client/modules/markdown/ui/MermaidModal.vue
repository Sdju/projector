<script setup lang="ts">
import { computed } from "vue";
import ImageModal from "../../../common/ui/ImageModal.vue";
import { renderMermaidPreview } from "../lib/mermaid.ts";

const props = defineProps<{ source: string }>();
const emit = defineEmits<{ close: [] }>();
const preview = computed(() => renderMermaidPreview(props.source));
</script>

<template>
  <ImageModal
    :svg="preview.svg"
    :width="preview.width"
    :height="preview.height"
    alt="Диаграмма Mermaid"
    @close="emit('close')"
  />
</template>
