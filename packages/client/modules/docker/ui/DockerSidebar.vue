<script setup lang="ts">
import UiToolbar from "../../../common/ui/UiToolbar.vue";
import UiScrollArea from "../../../common/ui/UiScrollArea.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import DockerDaemonNotice from "./DockerDaemonNotice.vue";
import { useDockerState } from "../model.ts";
const { snapshot, error, starting, commands, projectContainers: containers } = useDockerState();
</script>
<template>
  <UiScrollArea class="docker-sidebar" @pointerdown="commands.scope.activate()">
    <UiToolbar as="header" justify="between" text="xs">
      <span>{{ snapshot?.binding?.name || "Docker" }}</span
      ><UiButton size="sm" @click="commands.run('ide.docker.open')">открыть</UiButton>
    </UiToolbar>
    <DockerDaemonNotice
      v-if="error || snapshot?.error"
      :message="error || snapshot?.error || ''"
      :daemon="snapshot?.daemon"
      :starting="starting"
      @start="commands.run('ide.docker.daemon.start')"
    />
    <UiEmpty v-else-if="!snapshot">Подключение…</UiEmpty>
    <UiEmpty v-else-if="!snapshot.enabled">Включите Docker в настройках интеграций.</UiEmpty>
    <UiEmpty v-else-if="!snapshot.binding">Откройте Docker и привяжите Compose к проекту.</UiEmpty>
    <UiEmpty v-else-if="!containers.length">Контейнеры ещё не созданы.</UiEmpty>
    <button
      v-for="item in containers"
      :key="item.id"
      class="row"
      @click="commands.run('ide.docker.open', { containerId: item.id })"
    >
      <span
        class="dot"
        :class="{
          running: item.state === 'running',
          failed: item.health === 'unhealthy' || (item.state === 'exited' && item.exitCode !== 0),
        }"
        >●</span
      >
      <span class="name">{{ item.service || item.name }}</span>
      <span class="status"
        >{{ item.health || item.state
        }}{{ item.state === "exited" ? ` · ${item.exitCode}` : "" }}</span
      >
    </button>
  </UiScrollArea>
</template>
<style scoped>
.row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
}
.row:hover {
  background: var(--bg-2);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.status {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.dot {
  color: var(--faint);
}
.running {
  color: var(--run);
}
.failed {
  color: var(--err);
}
</style>
