<script setup lang="ts">
import { watchEffect } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import { useTrajectoryDocument } from "../model/store.ts";
import AgentTrajectoryPanel from "./AgentTrajectoryPanel.vue";

const props = defineProps<{
  id?: string;
  onTitle?: (title: string) => void;
  onOpenFile?: (path: string) => void;
}>();
const document = useTrajectoryDocument(() => props.id);

watchEffect(() => {
  if (document.value) props.onTitle?.(document.value.title);
});
</script>

<template>
  <div class="trajectory-tab">
    <AgentTrajectoryPanel
      v-if="document"
      :data="document.data"
      :title="document.title"
      :subtitle="document.subtitle"
      @open-file="(path) => onOpenFile?.(path)"
    />
    <div v-else class="empty-state">
      <ProjectorIcon name="list-tree" class="empty-icon" aria-hidden="true" />
      <strong>Нет данных траектории</strong>
      <p>Откройте файл .trajectory.json или передайте документ из агента.</p>
    </div>
  </div>
</template>

<style scoped>
.trajectory-tab {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
}
.empty-state {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-6);
  color: var(--muted);
  text-align: center;
}
.empty-state strong {
  color: var(--text-2);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.empty-state p {
  max-width: 320px;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.empty-icon {
  width: 28px;
  height: 28px;
  margin-bottom: var(--sp-1);
  color: var(--faint);
}
</style>
