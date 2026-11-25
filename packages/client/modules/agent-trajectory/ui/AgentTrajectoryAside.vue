<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import { latestTrajectoryDocument } from "../model/store.ts";
import AgentTrajectoryPanel from "./AgentTrajectoryPanel.vue";

const props = defineProps<{ onOpenFile?: (path: string) => void }>();
const document = latestTrajectoryDocument();
</script>

<template>
  <div class="trajectory-aside">
    <AgentTrajectoryPanel
      v-if="document"
      :data="document.data"
      :title="document.title"
      :subtitle="document.subtitle"
      @open-file="(path) => props.onOpenFile?.(path)"
    />
    <div v-else class="empty-state">
      <ProjectorIcon name="list-tree" class="empty-icon" aria-hidden="true" />
      <strong>Нет данных траектории</strong>
      <p>Откройте файл .trajectory.json или передайте документ из агента.</p>
    </div>
  </div>
</template>

<style scoped>
.trajectory-aside {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.empty-state {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-5);
  color: var(--muted);
  text-align: center;
}
.empty-state strong {
  color: var(--text-2);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.empty-state p {
  max-width: 260px;
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.empty-icon {
  width: 24px;
  height: 24px;
  margin-bottom: var(--sp-1);
  color: var(--faint);
}
</style>
