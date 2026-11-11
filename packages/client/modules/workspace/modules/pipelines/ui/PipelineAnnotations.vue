<script setup lang="ts">
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiBadge from "../../../../../common/ui/UiBadge.vue";
import { countRu } from "../../../../../common/utilities/plural.ts";
import type { PipelineAnnotation } from "@ai-projector/core/modules/workspace/index.ts";
import {
  PIPELINE_ANNOTATION_LEVEL_LABEL,
  PIPELINE_ANNOTATION_LEVEL_TONE,
} from "@ai-projector/core/modules/workspace/index.ts";

defineProps<{
  items: PipelineAnnotation[];
  truncated?: boolean;
  host: string;
}>();
const emit = defineEmits<{ open: [file: { path: string; line?: number }] }>();

const location = (item: PipelineAnnotation) => {
  if (!item.path) return "";
  return item.startLine ? `${item.path}:${item.startLine}` : item.path;
};
</script>

<template>
  <section v-if="items.length" class="notes">
    <UiHeading as="h3" size="sm" tone="secondary" :space-before="4" :space-after="2">{{
      countRu(items.length, "аннотация", "аннотации", "аннотаций")
    }}</UiHeading>
    <ul class="list">
      <li v-for="(item, index) in items" :key="`${item.path}:${item.startLine}:${index}`">
        <UiBadge :tone="PIPELINE_ANNOTATION_LEVEL_TONE[item.level]">{{
          PIPELINE_ANNOTATION_LEVEL_LABEL[item.level]
        }}</UiBadge>
        <div class="body">
          <button
            v-if="item.path"
            type="button"
            class="file"
            :title="`Открыть ${location(item)}`"
            @click="emit('open', { path: item.path, line: item.startLine ?? undefined })"
          >
            {{ location(item) }}
          </button>
          <p v-if="item.title" class="title">{{ item.title }}</p>
          <p class="message">{{ item.message }}</p>
        </div>
      </li>
    </ul>
    <UiHint v-if="truncated" size="xs" leading="inherit" :space-before="2" class="note">
      Показаны не все аннотации. Полный список — на {{ host }}.
    </UiHint>
  </section>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.list li {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
}
.list li + li {
  border-top: 1px solid var(--line);
}
.body {
  min-width: 0;
  flex: 1;
}
.file {
  color: var(--text-2);
  font: var(--fs-2xs) var(--mono);
  text-align: left;
}
.file:hover {
  color: var(--text);
  text-decoration: underline;
}
.title {
  margin: 2px 0 0;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 500;
}
.message {
  margin: 2px 0 0;
  color: var(--text-2);
  font: var(--fs-2xs) / 1.45 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
