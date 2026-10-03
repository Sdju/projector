<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import IconWindow from "~icons/lucide/panels-top-left";
import IconOpen from "~icons/lucide/external-link";
import IconStop from "~icons/lucide/square";
import type { Project } from "../../catalog/index.ts";
import { useRunner } from "../model/session.ts";

const props = defineProps<{
  project: Project;
  compact?: boolean;
  toolbar?: boolean;
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
  <div class="controls" :class="{ toolbar }" role="group" aria-label="Запуск проекта">
    <template v-if="!busy">
      <UiButton
        v-for="command in compact
          ? project.commands.filter((item) => item.id === project.defaultCommandId)
          : project.commands"
        :key="command.id"
        variant="chip"
        :active="command.id === project.defaultCommandId"
        :title="command.cmd"
        @click="run(command.id)"
      >
        {{ command.name }}
      </UiButton>
      <UiButton
        :icon="toolbar"
        :size="toolbar ? 'sm' : undefined"
        :variant="toolbar ? 'ghost' : 'chip'"
        title="Открыть в окне"
        aria-label="Открыть проект в окне"
        @click="runWindow"
        ><IconWindow v-if="toolbar" aria-hidden="true" /><template v-else>окно</template></UiButton
      >
    </template>
    <template v-else>
      <UiButton
        :icon="toolbar"
        :size="toolbar ? 'sm' : undefined"
        :variant="toolbar ? 'ghost' : 'chip'"
        title="Открыть в браузере"
        aria-label="Открыть проект в браузере"
        @click="runner.open(project.id, 'server')"
        ><IconOpen v-if="toolbar" aria-hidden="true" /><template v-else>открыть</template></UiButton
      >
      <UiButton
        :icon="toolbar"
        :size="toolbar ? 'sm' : undefined"
        :variant="toolbar ? 'ghost' : 'chip'"
        title="Открыть в окне"
        aria-label="Открыть проект в окне"
        @click="runWindow"
        ><IconWindow v-if="toolbar" aria-hidden="true" /><template v-else>окно</template></UiButton
      >
      <UiButton
        :icon="toolbar"
        :size="toolbar ? 'sm' : undefined"
        variant="danger"
        title="Остановить проект"
        aria-label="Остановить проект"
        @click="runner.stop(project.id)"
        ><IconStop v-if="toolbar" aria-hidden="true" /><template v-else>стоп</template></UiButton
      >
    </template>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.toolbar {
  align-items: center;
  gap: var(--sp-1);
}
</style>
