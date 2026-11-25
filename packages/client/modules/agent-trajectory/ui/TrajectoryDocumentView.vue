<script setup lang="ts">
import { computed, watchEffect } from "vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { trajectoryDocumentFrom } from "../model/documents.ts";
import { storeTrajectoryDocument } from "../model/store.ts";
import AgentTrajectoryPanel from "./AgentTrajectoryPanel.vue";

const props = defineProps<{
  content: string;
  path: string;
  onOpenFile?: (path: string) => void;
}>();
const parsed = computed(() => {
  try {
    return {
      document: trajectoryDocumentFrom(props.content, {
        id: `file:${props.path}`,
        source: "file",
      }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось прочитать траекторию" };
  }
});

// Opening the file also makes it the panel's latest document.
watchEffect(() => {
  if (parsed.value.document) storeTrajectoryDocument(parsed.value.document);
});

const raw = computed(() =>
  props.content.length > 12_000 ? `${props.content.slice(0, 12_000)}\n…` : props.content,
);
</script>

<template>
  <div class="trajectory-document">
    <AgentTrajectoryPanel
      v-if="parsed.document"
      :data="parsed.document.data"
      :title="parsed.document.title"
      :subtitle="parsed.document.subtitle"
      @open-file="(path) => onOpenFile?.(path)"
    />
    <div v-else class="error">
      <UiMessage tone="danger" variant="note">
        {{ parsed.error }}. Ожидается JSON-документ траектории; поддерживаются
        <code>.trajectory.json</code> и <code>.trace.json</code>.
      </UiMessage>
      <pre class="raw">{{ raw }}</pre>
    </div>
  </div>
</template>

<style scoped>
.trajectory-document {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
}
.error {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: var(--sp-3);
}
.raw {
  margin: var(--sp-2) 0 0;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text-2);
  font: var(--fs-2xs) var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
code {
  font: var(--fs-2xs) var(--mono);
}
</style>
