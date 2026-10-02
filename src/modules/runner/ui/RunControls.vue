<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { Project } from "../../catalog/index.ts";
import { useRunner } from "../model/session.ts";

const props = defineProps<{
  project: Project;
  compact?: boolean;
}>();

const runner = useRunner();
const status = computed(() => props.project.runtime?.status ?? "idle");
const busy = computed(() => status.value === "running" || status.value === "starting");

function run(commandId: string): void {
  void runner.start(props.project.id, commandId);
}

function runWindow(): void {
  if (!busy.value) {
    void runner.start(props.project.id, props.project.defaultCommandId, "window");
    return;
  }
  void runner.open(props.project.id, "window");
}
</script>

<template>
  <div class="controls">
    <template v-if="!busy">
      <UiButton
        v-for="command in compact
          ? project.commands.filter((item) => item.id === project.defaultCommandId)
          : project.commands"
        :key="command.id"
        variant="chip"
        :active="command.id === project.defaultCommandId"
        @click="run(command.id)"
      >
        {{ command.name }}
      </UiButton>
      <UiButton variant="chip" @click="runWindow">окно</UiButton>
    </template>
    <template v-else>
      <UiButton variant="chip" @click="runner.open(project.id, 'server')">открыть</UiButton>
      <UiButton variant="chip" @click="runWindow">окно</UiButton>
      <UiButton variant="danger" @click="runner.stop(project.id)">стоп</UiButton>
    </template>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
